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

// localStorage quota is ~5 MB for the xpui origin, shared with Spotify's own
// keys and other local modules, so thresholds are conservative. Counted in
// UTF-16 code units (JSON.stringify(...).length), the unit the quota counts.
const WARN_BYTES = 4_000_000;
const ABORT_BYTES = 4_500_000;

export function estimateRecordSize(rec: object): number {
	return JSON.stringify(rec).length;
}

function largestFiles(rec: LocalModuleRecord, n = 3): string {
	return Object.entries(rec.files ?? {})
		.map(([f, c]) => [f, c.length] as const)
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.map(([f, len]) => `${f} (~${Math.round(len / 1024)}KB)`)
		.join(", ");
}

// checkQuota estimates the serialized install size before the socket opens:
// over the abort threshold it refuses with guidance, over the warn threshold
// it prints the size and the largest files.
export function checkQuota(rec: LocalModuleRecord, log: (m: string) => void = console.warn): void {
	const size = estimateRecordSize(rec);
	if (size >= ABORT_BYTES) {
		throw new Error(
			`install is ~${Math.round(size / 1024)}KB, over the ~${Math.round(ABORT_BYTES / 1024)}KB local-install ` +
				`limit (localStorage is shared across the whole client). Largest: ${largestFiles(rec)}. ` +
				"Sourcemaps and assets are already excluded — trim shipped chunks or split the module.",
		);
	}
	if (size >= WARN_BYTES) {
		log(
			`[push] warning: install is ~${Math.round(size / 1024)}KB, approaching the local-install limit. ` +
				`Largest: ${largestFiles(rec)}`,
		);
	}
}

// interpretResult turns a CDP Runtime.evaluate response into a value or a
// named error. A client-side QuotaExceededError arrives via exceptionDetails
// (not the resolved value), so it is detected and translated here.
export function interpretResult(msg: {
	result?: {
		result?: { value?: string };
		exceptionDetails?: { text?: string; exception?: { description?: string } };
	};
}): { value: string } | { error: string } {
	const ex = msg.result?.exceptionDetails;
	if (ex) {
		const text = ex.exception?.description ?? ex.text ?? JSON.stringify(ex);
		if (/quota/i.test(text)) {
			return {
				error:
					"client rejected the install: localStorage quota exceeded (shared across the whole client). " +
					"Trim shipped chunks or split the module.",
			};
		}
		return { error: `client evaluation error: ${text.slice(0, 200)}` };
	}
	return { value: msg.result?.result?.value ?? JSON.stringify(msg) };
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

// stampRecord appends an execution stamp to the record's js entry. The push
// asserts the stamp after enable, turning "the client says loaded" into "the
// pushed code demonstrably ran". A loaded flag alone can be a stale instance:
// the dev loop once reported a build live whose code had never executed.
// Returns false when the record has no js entry to stamp (css-only themes).
export function stampRecord(rec: LocalModuleRecord, id: string, nonce: string): boolean {
	const entry = (rec.metadata as { entries?: { js?: string } }).entries?.js;
	if (!entry || typeof rec.files[entry] !== "string") return false;
	rec.files[entry] +=
		`\nglobalThis.__spicetifyPushStamps = Object.assign(globalThis.__spicetifyPushStamps ?? {}, ${JSON.stringify({ [id]: nonce })});\n`;
	return true;
}

export function newNonce(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

export function push(rec: LocalModuleRecord, id: string, port: string): Promise<string> {
	// Stamp before the quota check so the stamp's own bytes are counted.
	const nonce = newNonce();
	const stamped = stampRecord(rec, id, nonce);
	// Refuse an oversized install before opening the socket (U7), so the failure
	// is a named cause here rather than an opaque client-side quota error.
	checkQuota(rec);
	// The whole exchange runs in the client: disable the old instance, install
	// the fresh content, and re-enable anything the unload cascade took down.
	const expr = `(async () => {
		const M = globalThis.Spicetify?.Modules;
		if (!M) return JSON.stringify({ error: "loader not ready" });
		const rec = ${JSON.stringify(rec)};
		const id = ${JSON.stringify(id)};
		const before = M.list().filter((m) => m.loaded).map((m) => m.identifier);
		const hadPrevious = before.includes(id);
		await M.disable(id).catch(() => {});
		await M.installLocal(id, rec);
		// Re-enabling a theme the loader just unloaded would fight the
		// single-active-theme invariant and knock the pushed theme back off.
		const pushedIsTheme = (rec.metadata.tags ?? []).includes("theme");
		const isTheme = (mid) => ((M.manifest?.modules?.find((m) => m.identifier === mid)?.tags) ?? []).includes("theme");
		for (const other of before) {
			if (pushedIsTheme && isTheme(other)) continue;
			const s = M.list().find((m) => m.identifier === other);
			if (s && !s.loaded) await M.enable(other).catch(() => {});
		}
		const s = M.list().find((m) => m.identifier === id);
		const stampLive = ${stamped ? `globalThis.__spicetifyPushStamps?.[id] === ${JSON.stringify(nonce)}` : "null"};
		return JSON.stringify({
			loaded: s?.loaded ?? false,
			failed: M.report?.failed?.[id] ?? null,
			stamp: ${stamped ? '(stampLive ? "live" : "stale")' : '"unstamped"'},
			hadPrevious,
		});
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
				const outcome = interpretResult(msg);
				if ("error" in outcome) reject(new Error(outcome.error));
				else resolve(outcome.value);
			});
		}, reject);
	});
}

// Turn the raw client-side push result into an honest, actionable line.
export function formatPushResult(raw: string): { ok: boolean; message: string } {
	let parsed: {
		error?: string;
		loaded?: boolean;
		failed?: string | null;
		stamp?: "live" | "stale" | "unstamped";
		hadPrevious?: boolean;
	};
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
	if (parsed.loaded !== true) return { ok: false, message: "installed but not loaded" };
	// The loaded flag alone is not proof the pushed code runs; the stamp is.
	if (parsed.stamp === "stale") {
		return {
			ok: false,
			message:
				"installed, but the pushed code did NOT execute — a stale instance is still live. " +
				"Restart the client (or removeLocal, then push again) before trusting any verification.",
		};
	}
	const remount = parsed.hadPrevious
		? " — UI mounted before the push may still be the old build; re-navigate to its surface to remount"
		: "";
	if (parsed.stamp === "live") return { ok: true, message: `loaded, pushed build verified executing${remount}` };
	// css-only records carry no executable entry to stamp.
	if (parsed.stamp === "unstamped") return { ok: true, message: `loaded (css-only, no execution stamp)${remount}` };
	return { ok: true, message: "loaded" };
}
