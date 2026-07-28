/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * dev - hot-push a module into a running Spotify client.
 *
 * Watches the module's sources; on change it rebuilds and pushes the
 * fresh bundle over the Chrome DevTools Protocol as a local install
 * (Spicetify.Modules.installLocal), so nothing in the staged app bundle
 * is touched and the loop is sub-second. Spotify must be running with
 * --remote-debugging-port=<port>. Remove the override afterwards with
 * Spicetify.Modules.removeLocal("<name>") (or from the manager page) to
 * fall back to the staged copy.
 */

import { readdirSync, readFileSync, statSync, watch } from "node:fs";
import path from "node:path";

import { buildModule, readMetadata, resolveModuleDir } from "./build.ts";
import { loadConfig, resolveClassmap, type ClassmapResolution } from "./classmap.ts";
import { launchSpotify } from "./launch.ts";

const USAGE =
	"spicetify-kit dev <module> [--launch] [--port 9229] [--once] [--classmap <key|path>] [--out <dir>]\n" +
	"  --launch   start (or reuse) Spotify with the remote-debugging port itself";

// Turn the raw client-side push result into an honest, actionable line.
export function formatPushResult(raw: string): { ok: boolean; message: string } {
	let parsed: { error?: string; loaded?: boolean; failed?: string | null };
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, message: `unexpected push result (not JSON): ${raw}` };
	}
	if (parsed.error === "loader not ready") {
		return {
			ok: false,
			message:
				"the v3 loader is not staged in this client (Spicetify.Modules is absent). " +
				"Run `spicetify apply` with v3 modules installed, then retry.",
		};
	}
	if (parsed.failed) return { ok: false, message: `module loaded but failed: ${parsed.failed}` };
	return { ok: parsed.loaded === true, message: parsed.loaded ? "loaded" : "installed but not loaded" };
}

function record(distDir: string, id: string) {
	const metadata = JSON.parse(readFileSync(path.join(distDir, "metadata.json"), "utf8"));
	metadata.identifier = id;
	const sidecar = JSON.parse(readFileSync(path.join(distDir, "spicetify-module.json"), "utf8"));
	const files: Record<string, string> = {};
	for (const f of readdirSync(distDir)) {
		// Maps and asset dirs stay out of localStorage; metadata rides
		// separately. Assets only matter to store cards, not the runtime.
		if (f === "metadata.json" || f.endsWith(".map")) continue;
		if (statSync(path.join(distDir, f)).isDirectory()) continue;
		files[f] = readFileSync(path.join(distDir, f), "utf8");
	}
	return { metadata, files, sidecar };
}

async function wsUrl(port: string): Promise<string> {
	const res = await fetch(`http://localhost:${port}/json/list`);
	const targets = (await res.json()) as Array<{ url?: string; webSocketDebuggerUrl?: string }>;
	const target = targets.find((t) => t.url?.includes("xpui"));
	if (!target?.webSocketDebuggerUrl) {
		throw new Error(
			`no xpui debug target on port ${port}. Start Spotify with --remote-debugging-port=${port} ` +
				"(or pass --launch), and ensure `spicetify apply` has staged the v3 loader.",
		);
	}
	return target.webSocketDebuggerUrl;
}

function push(rec: object, id: string, port: string): Promise<string> {
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
		void wsUrl(port).then((url) => {
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
				ws.send(
					JSON.stringify({
						id: 1,
						method: "Runtime.evaluate",
						params: { expression: expr, awaitPromise: true, returnByValue: true },
					}),
				);
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

export async function runDev(argv: string[], cwd = process.cwd()): Promise<void> {
	const moduleArg = argv.find((a) => !a.startsWith("--"));
	const flag = (n: string) => {
		const i = argv.indexOf(`--${n}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	if (!moduleArg) throw new Error(USAGE);
	const port = flag("port") ?? "9229";
	const once = argv.includes("--once");

	if (argv.includes("--launch")) await launchSpotify(port);

	const config = loadConfig(cwd);
	const modulesDir = config.modulesDir ? path.resolve(cwd, config.modulesDir) : path.join(cwd, "modules");
	const outDir = flag("out") ?? (config.outDir ? path.resolve(cwd, config.outDir) : path.join(cwd, "dist"));
	const moduleDir = resolveModuleDir(moduleArg, modulesDir, cwd);
	const id = readMetadata(moduleDir).name;

	const resolved: ClassmapResolution = await resolveClassmap({ flag: flag("classmap") ?? null, config, cwd });
	if (!resolved.path) throw new Error("no classmap found (pass --classmap <key|path>)");

	const cycle = async () => {
		const started = Date.now();
		let distDir: string;
		try {
			distDir = await buildModule(moduleDir, outDir, resolved, cwd);
		} catch (e) {
			console.error(`[dev] build failed: ${(e as Error).message}`);
			return;
		}
		try {
			const raw = await push(record(distDir, id), id, port);
			const result = formatPushResult(raw);
			const line = `[dev] ${id} ${result.message} (${Date.now() - started}ms)`;
			if (result.ok) console.log(line);
			else console.error(line);
		} catch (e) {
			console.error(`[dev] push failed: ${(e as Error).message}`);
		}
	};

	await cycle();
	if (once) return;

	console.log(`[dev] watching ${moduleDir} (ctrl-c to stop; removeLocal("${id}") drops the override)`);
	let timer: NodeJS.Timeout | undefined;
	watch(moduleDir, { recursive: true }, (_event, file) => {
		// The build regenerates classmap.d.ts into the source dir on every
		// run; reacting to it would loop forever.
		if (!file || file.endsWith(".d.ts") || file.startsWith(".")) return;
		clearTimeout(timer);
		timer = setTimeout(() => void cycle(), 200);
	});
	// Keep the process alive while the watcher runs.
	await new Promise(() => {});
}
