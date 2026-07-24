#!/usr/bin/env node
/**
 * dev - hot-push a module into a running Spotify client.
 *
 * usage:
 *   node scripts/dev.ts modules/<name> [--port 9229] [--once]
 *
 * Watches the module's sources; on change it rebuilds with stitch and
 * pushes the fresh bundle over the Chrome DevTools Protocol as a local
 * install (Spicetify.Modules.installLocal), so nothing in the staged app
 * bundle is touched and the loop is sub-second. Spotify must be running
 * with --remote-debugging-port=<port>. Remove the override afterwards
 * with Spicetify.Modules.removeLocal("<name>") (or from the manager
 * page) to fall back to the staged copy.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, watch } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const moduleDir = args.find((a) => !a.startsWith("--"));
const flag = (n: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const port = flag("port") ?? "9229";
const once = args.includes("--once");

if (!moduleDir) {
	console.error("usage: node scripts/dev.ts modules/<name> [--port 9229] [--once]");
	process.exit(1);
}
const absDir = path.resolve(moduleDir);
const meta = JSON.parse(readFileSync(path.join(absDir, "metadata.json"), "utf8"));
const id: string = meta.name;

function build(): string | null {
	try {
		execFileSync("node", ["scripts/stitch.ts", moduleDir!], { stdio: ["ignore", "ignore", "pipe"] });
	} catch (e) {
		console.error(`[dev] build failed:\n${(e as { stderr?: Buffer }).stderr ?? (e as Error).message}`);
		return null;
	}
	const version = JSON.parse(readFileSync(path.join(absDir, "metadata.json"), "utf8")).version;
	return path.join(process.cwd(), "dist", `${id}@${version}`);
}

function record(distDir: string) {
	const metadata = JSON.parse(readFileSync(path.join(distDir, "metadata.json"), "utf8"));
	metadata.identifier = id;
	const sidecar = JSON.parse(readFileSync(path.join(distDir, "spicetify-module.json"), "utf8"));
	const files: Record<string, string> = {};
	for (const f of readdirSync(distDir)) {
		// Maps stay out of localStorage; metadata rides separately.
		if (f === "metadata.json" || f.endsWith(".map")) continue;
		files[f] = readFileSync(path.join(distDir, f), "utf8");
	}
	return { metadata, files, sidecar };
}

async function wsUrl(): Promise<string> {
	const res = await fetch(`http://localhost:${port}/json/list`);
	const targets = (await res.json()) as Array<{ url?: string; webSocketDebuggerUrl?: string }>;
	const target = targets.find((t) => t.url?.includes("xpui"));
	if (!target?.webSocketDebuggerUrl) throw new Error("no xpui target; is Spotify running with --remote-debugging-port?");
	return target.webSocketDebuggerUrl;
}

function push(rec: object): Promise<string> {
	// The whole exchange runs in the client: disable the old instance,
	// install the fresh content, and re-enable anything the unload cascade
	// took down with it.
	const expr = `(async () => {
		const M = globalThis.Spicetify?.Modules;
		if (!M) return JSON.stringify({ error: "loader not ready" });
		const rec = ${JSON.stringify(rec)};
		const id = ${JSON.stringify(id)};
		const before = M.list().filter((m) => m.loaded).map((m) => m.identifier);
		await M.disable(id).catch(() => {});
		await M.installLocal(id, rec);
		for (const other of before) {
			const s = M.list().find((m) => m.identifier === other);
			if (s && !s.loaded) await M.enable(other).catch(() => {});
		}
		const s = M.list().find((m) => m.identifier === id);
		return JSON.stringify({ loaded: s?.loaded ?? false, failed: M.report?.failed?.[id] ?? null });
	})()`;

	return new Promise((resolve, reject) => {
		void wsUrl().then((url) => {
			const ws = new WebSocket(url);
			const timer = setTimeout(() => {
				ws.close();
				reject(new Error("push timed out"));
			}, 15_000);
			ws.addEventListener("error", (e) => {
				clearTimeout(timer);
				reject(new Error(`websocket error: ${String((e as ErrorEvent).message ?? e)}`));
			});
			ws.addEventListener("open", () => {
				ws.send(JSON.stringify({
					id: 1,
					method: "Runtime.evaluate",
					params: { expression: expr, awaitPromise: true, returnByValue: true },
				}));
			});
			ws.addEventListener("message", (ev) => {
				const msg = JSON.parse(String(ev.data));
				if (msg.id !== 1) return;
				clearTimeout(timer);
				ws.close();
				resolve(msg.result?.result?.value ?? JSON.stringify(msg));
			});
		}, reject);
	});
}

async function cycle(): Promise<void> {
	const started = Date.now();
	const distDir = build();
	if (!distDir) return;
	try {
		const result = await push(record(distDir));
		console.log(`[dev] ${id} pushed in ${Date.now() - started}ms -> ${result}`);
	} catch (e) {
		console.error(`[dev] push failed: ${(e as Error).message}`);
	}
}

await cycle();
if (!once) {
	console.log(`[dev] watching ${moduleDir} (ctrl-c to stop; removeLocal("${id}") drops the override)`);
	let timer: NodeJS.Timeout | undefined;
	watch(absDir, { recursive: true }, (_event, file) => {
		// stitch regenerates classmap.d.ts into the source dir on every
		// build; reacting to it would loop forever.
		if (!file || file.endsWith(".d.ts") || file.startsWith(".")) return;
		clearTimeout(timer);
		timer = setTimeout(() => void cycle(), 200);
	});
}
