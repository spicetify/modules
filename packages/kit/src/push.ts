/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * push - shared CDP hot-push machinery for the dev loop and install.
 *
 * Builds the LocalModuleRecord a dist dir installs as (metadata + files +
 * sidecar), finds the client's xpui debug target, and runs
 * Spicetify.Modules.installLocal in the client so nothing in the staged app
 * bundle is touched.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface LocalModuleRecord {
	metadata: Record<string, unknown>;
	files: Record<string, string>;
	sidecar: Record<string, unknown>;
}

// record builds the install payload from a dist dir. Maps and asset dirs stay
// out of localStorage; metadata rides separately (it is stamped with the id).
export function record(distDir: string, id: string): LocalModuleRecord {
	const metadata = JSON.parse(readFileSync(path.join(distDir, "metadata.json"), "utf8"));
	metadata.identifier = id;
	const sidecar = JSON.parse(readFileSync(path.join(distDir, "spicetify-module.json"), "utf8"));
	const files: Record<string, string> = {};
	for (const f of readdirSync(distDir)) {
		if (f === "metadata.json" || f.endsWith(".map")) continue;
		if (statSync(path.join(distDir, f)).isDirectory()) continue;
		files[f] = readFileSync(path.join(distDir, f), "utf8");
	}
	return { metadata, files, sidecar };
}

export async function wsUrl(port: string): Promise<string> {
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

export function push(rec: object, id: string, port: string): Promise<string> {
	// The whole exchange runs in the client: disable the old instance, install
	// the fresh content, and re-enable anything the unload cascade took down.
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
