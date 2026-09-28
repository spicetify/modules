/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { launchSpotify, waitForTarget } from "../src/launch.ts";
import { classifyDevtools, formatRemoveOutcome, probePort, resolvePort, type PortProbe } from "../src/push.ts";
import { moduleId } from "../src/remove.ts";

const SPOTIFY_UA = "Mozilla/5.0 (Macintosh) Chrome/146.0.7680.179 Spotify/1.3.0.277";
const XPUI = { url: "https://xpui.app.spotify.com/index.html", webSocketDebuggerUrl: "ws://localhost/page/1" };

describe("classifyDevtools", () => {
	it("recognizes a loaded xpui page", () => {
		assert.deepEqual(classifyDevtools({ "User-Agent": SPOTIFY_UA }, [XPUI]), {
			state: "xpui",
			ws: "ws://localhost/page/1",
		});
	});

	it("treats Spotify without xpui as still starting", () => {
		assert.deepEqual(classifyDevtools({ "User-Agent": SPOTIFY_UA }, []), { state: "spotify" });
	});

	it("names the Node inspector as a foreign listener", () => {
		const r = classifyDevtools({ Browser: "node.js/v24.3.0" }, [{ type: "node", title: "workers" }]);
		assert.deepEqual(r, { state: "other", what: "node.js/v24.3.0" });
	});
});

describe("probePort", () => {
	const servers: Array<{ close: () => void }> = [];
	after(() => {
		for (const s of servers) s.close();
	});

	const listen = async (server: Server | ReturnType<typeof createNetServer>): Promise<string> => {
		servers.push(server);
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		return String((server.address() as AddressInfo).port);
	};

	const devtools = (version: object, list: object[]) =>
		createHttpServer((req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(req.url === "/json/version" ? version : list));
		});

	it("reports a closed port as free", async () => {
		const probe = createNetServer();
		const port = await listen(probe);
		probe.close();
		assert.deepEqual(await probePort(port), { state: "free" });
	});

	it("reports a non-HTTP listener as unidentified", async () => {
		const port = await listen(createNetServer((sock) => sock.destroy()));
		assert.equal((await probePort(port)).state, "unknown");
	});

	it("gives up on a listener that accepts but never replies", async () => {
		const port = await listen(createNetServer(() => {}));
		assert.equal((await probePort(port)).state, "unknown");
	});

	it("survives a DevTools endpoint that answers with null bodies", async () => {
		const server = createHttpServer((_req, res) => res.end("null"));
		const port = await listen(server);
		assert.deepEqual(await probePort(port), { state: "other", what: "an unknown DevTools endpoint" });
	});

	it("does not mistake a browser tab on a spotify.com page for the client", async () => {
		const port = await listen(
			devtools({ "User-Agent": "Mozilla/5.0 Chrome/146.0", Browser: "Chrome/146.0" }, [
				{ type: "page", url: "https://open.spotify.com/", webSocketDebuggerUrl: "ws://x" },
			]),
		);
		assert.deepEqual(await probePort(port), { state: "other", what: "Chrome/146.0" });
	});

	it("reports a Node inspector as foreign", async () => {
		const port = await listen(devtools({ Browser: "node.js/v24.3.0" }, [{ type: "node", title: "workers" }]));
		assert.deepEqual(await probePort(port), { state: "other", what: "node.js/v24.3.0" });
	});

	it("finds the xpui target on a Spotify endpoint", async () => {
		const port = await listen(devtools({ "User-Agent": SPOTIFY_UA }, [XPUI]));
		assert.equal((await probePort(port)).state, "xpui");
	});
});

describe("launchSpotify", () => {
	const fixed =
		(...states: PortProbe[]) =>
		async () =>
			states.length > 1 ? states.shift()! : states[0];

	it("reuses a client that already serves xpui", async () => {
		const r = await launchSpotify("9229", () => {}, "linux", fixed({ state: "xpui", ws: "ws://x" }));
		assert.equal(r, "reused");
	});

	it("waits for a Spotify that is still starting instead of restarting it", async () => {
		const r = await launchSpotify(
			"9229",
			() => {},
			"linux",
			fixed({ state: "spotify" }, { state: "xpui", ws: "ws://x" }),
		);
		assert.equal(r, "reused");
	});

	it("refuses a port held by an unidentified listener", async () => {
		await assert.rejects(
			launchSpotify("9229", () => {}, "linux", fixed({ state: "unknown" })),
			/already in use/,
		);
	});

	it("refuses a port held by another process before touching Spotify", async () => {
		await assert.rejects(
			launchSpotify("9229", () => {}, "linux", fixed({ state: "other", what: "node.js/v24.3.0" })),
			/port 9229 is already in use by node\.js\/v24\.3\.0.*--port <n> or SPICETIFY_CDP_PORT/s,
		);
	});
});

describe("waitForTarget", () => {
	it("keeps polling through an unidentified answer while Spotify binds the port", async () => {
		const states: PortProbe[] = [{ state: "unknown" }, { state: "xpui", ws: "ws://x" }];
		await waitForTarget("9229", 5_000, async () => states.shift()!);
	});

	it("fails fast when a foreign listener takes the port", async () => {
		const started = Date.now();
		await assert.rejects(
			waitForTarget("9229", 30_000, async () => ({ state: "other", what: "node.js" })),
			/already in use/,
		);
		assert.ok(Date.now() - started < 1_000);
	});
});

describe("resolvePort", () => {
	it("prefers the flag, then SPICETIFY_CDP_PORT, then 9229", () => {
		assert.equal(resolvePort("9300", { SPICETIFY_CDP_PORT: "9301" }), "9300");
		assert.equal(resolvePort(undefined, { SPICETIFY_CDP_PORT: "9301" }), "9301");
		assert.equal(resolvePort(undefined, {}), "9229");
	});
});

describe("moduleId", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "kit-remove-"));
	after(() => rmSync(dir, { recursive: true, force: true }));

	it("reads the id from a module directory, else takes the argument as the id", () => {
		writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ name: "my-mod" }));
		assert.equal(moduleId(dir, "/"), "my-mod");
		assert.equal(moduleId("lyrics-plus", dir), "lyrics-plus");
	});
});

describe("remove messages", () => {
	it("names what the client falls back to after a removal", () => {
		assert.match(formatRemoveOutcome("m", { kind: "reverted", version: "1.2.0" }), /installed 1\.2\.0/);
		assert.match(formatRemoveOutcome("m", { kind: "none" }), /no local override/);
		assert.match(formatRemoveOutcome("m", { kind: "requires-restart" }), /restart Spotify/);
	});
});
