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

import { KIND_OF_META_SOURCE } from "./vault-metadata.ts";

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

export const DEFAULT_PORT = "9229";

// resolvePort picks the CDP port: an explicit --port, then SPICETIFY_CDP_PORT
// (shared with the monorepo's maintainer scripts), then the default.
export function resolvePort(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
	return flag ?? env.SPICETIFY_CDP_PORT ?? DEFAULT_PORT;
}

export type PortProbe =
	| { state: "xpui"; ws: string }
	| { state: "spotify" }
	| { state: "other"; what: string }
	| { state: "unknown" }
	| { state: "free" };

type DevtoolsTarget = { url?: unknown; type?: unknown; title?: unknown; webSocketDebuggerUrl?: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// classifyDevtools decides who owns a DevTools endpoint from its /json/version
// and /json/list bodies. Spotify's CEF user agent carries "Spotify/<version>";
// anything else (the Node inspector, wrangler, a browser) is a foreign listener
// that would make Spotify fail to bind the port.
export function classifyDevtools(version: Record<string, unknown>, targets: DevtoolsTarget[]): PortProbe {
	if (!/Spotify\//.test(String(version["User-Agent"] ?? ""))) {
		const first = targets[0];
		const what = String(version.Browser || first?.title || first?.type || "an unknown DevTools endpoint");
		return { state: "other", what };
	}
	for (const t of targets) {
		if (typeof t.url === "string" && t.url.includes("xpui") && typeof t.webSocketDebuggerUrl === "string") {
			return { state: "xpui", ws: t.webSocketDebuggerUrl };
		}
	}
	return { state: "spotify" };
}

// probePort reports whether the port is free, held by Spotify (with or without
// its xpui page loaded yet), held by something else, or answering in a way it
// cannot identify (a non-HTTP listener, or a client still binding the port).
export async function probePort(port: string): Promise<PortProbe> {
	let version: Record<string, unknown>;
	try {
		const res = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(2_000) });
		if (!res.ok) return { state: "unknown" };
		const body: unknown = await res.json();
		version = isRecord(body) ? body : {};
	} catch (e) {
		const code = (e as { cause?: { code?: string } }).cause?.code;
		return code === "ECONNREFUSED" ? { state: "free" } : { state: "unknown" };
	}
	let targets: DevtoolsTarget[] = [];
	try {
		const res = await fetch(`http://localhost:${port}/json/list`, { signal: AbortSignal.timeout(2_000) });
		const body: unknown = res.ok ? await res.json() : [];
		if (Array.isArray(body)) targets = body.filter(isRecord);
	} catch {
		/* version answered; an unreadable list classifies from the version alone */
	}
	return classifyDevtools(version, targets);
}

export function portInUseMessage(port: string, what: string): string {
	return (
		`port ${port} is already in use by ${what}, not Spotify. ` +
		"Node's inspector (node --inspect, wrangler dev) defaults to 9229 too. " +
		"Stop that process, or pick another port with --port <n> or SPICETIFY_CDP_PORT=<n>."
	);
}

export async function wsUrl(port: string): Promise<string> {
	const probe = await probePort(port);
	if (probe.state === "xpui") return probe.ws;
	if (probe.state === "other") throw new Error(portInUseMessage(port, probe.what));
	if (probe.state === "spotify") {
		throw new Error(
			`Spotify is listening on port ${port} but has no xpui page yet. ` +
				"Wait for it to finish starting, and ensure `spicetify apply` has staged the v3 loader.",
		);
	}
	if (probe.state === "unknown") {
		throw new Error(
			`port ${port} answered, but not as a Spotify DevTools endpoint; retry once Spotify has started.`,
		);
	}
	throw new Error(
		`no Spotify listening on port ${port}. Start it with --remote-debugging-port=${port}, ` +
			"or run `spicetify-kit dev`, which starts it for you.",
	);
}

// A freshly launched client exposes its xpui target before the loader has
// booted, so client-side code waits up to 10s for Spicetify.Modules.
const AWAIT_LOADER = `let M = globalThis.Spicetify?.Modules;
		for (let i = 0; !M && i < 100; i++) {
			await new Promise((r) => setTimeout(r, 100));
			M = globalThis.Spicetify?.Modules;
		}`;

// evaluate runs an expression in the xpui page over CDP and resolves with its
// string value.
export function evaluate(port: string, expr: string, timeoutMs = 15_000): Promise<string> {
	return new Promise((resolve, reject) => {
		void wsUrl(port).then((url) => {
			let ws: WebSocket;
			try {
				ws = new WebSocket(url);
			} catch (e) {
				reject(new Error(`could not open the client websocket: ${(e as Error).message}`));
				return;
			}
			const timer = setTimeout(() => {
				ws.close();
				reject(new Error("client evaluation timed out"));
			}, timeoutMs);
			ws.addEventListener("error", (e) => {
				clearTimeout(timer);
				reject(new Error(`websocket error: ${String((e as ErrorEvent).message ?? e)}`));
			});
			// A settled promise ignores this; it only fires for a socket the client
			// closed before answering (for instance Spotify quitting mid-push).
			ws.addEventListener("close", () => {
				clearTimeout(timer);
				reject(new Error("the client closed the connection before answering"));
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
				let msg;
				try {
					msg = JSON.parse(String(ev.data));
				} catch {
					return;
				}
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

export function push(rec: LocalModuleRecord, id: string, port: string): Promise<string> {
	// Stamp before the quota check so the stamp's own bytes are counted.
	const nonce = newNonce();
	const stamped = stampRecord(rec, id, nonce);
	// Refuse an oversized install before opening the socket (U7), so the failure
	// is a named cause here rather than an opaque client-side quota error.
	checkQuota(rec);
	return evaluate(port, pushExpression(rec, id, nonce, stamped));
}

/**
 * The expression push evaluates in the client: it installs the record, then
 * re-enables anything the unload cascade took down, except other themes when
 * the pushed module is one.
 */
export function pushExpression(rec: LocalModuleRecord, id: string, nonce: string, stamped: boolean): string {
	return `(async () => {
		${AWAIT_LOADER}
		if (!M) return JSON.stringify({ error: "loader not ready" });
		const rec = ${JSON.stringify(rec)};
		const id = ${JSON.stringify(id)};
		const before = M.list().filter((m) => m.loaded).map((m) => m.identifier);
		const hadPrevious = before.includes(id);
		const installed = await M.installLocal(id, rec);
		// installLocal keeps a module the client has marked disabled off. Pushing
		// it is an explicit request to run it, so load it for this session;
		// reload is transient, so the persisted choice still applies after removal.
		const reenabled = installed?.disabled === true;
		if (reenabled) await (M.reload ?? M.enable)(id);
		// Re-enabling a theme the loader just unloaded would fight the
		// single-active-theme invariant and knock the pushed theme back off.
		const kindOf = ${KIND_OF_META_SOURCE};
		const themed = (meta) => kindOf(meta) === "theme";
		const pushedIsTheme = themed(rec.metadata);
		const isTheme = (mid) => themed(M.manifest?.modules?.find((m) => m.identifier === mid));
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
			reenabled,
		});
	})()`;
}

export type RemoveOutcome =
	| { kind: "none" }
	| { kind: "removed" }
	| { kind: "reverted"; version: string }
	| { kind: "requires-restart" };

// removeLocal drops a hot-pushed override so the client falls back to the
// staged or store-installed copy.
export async function removeLocal(id: string, port: string): Promise<RemoveOutcome> {
	const raw = await evaluate(
		port,
		`(async () => {
		${AWAIT_LOADER}
		if (!M?.removeLocal) return JSON.stringify({ error: "loader not ready" });
		const id = ${JSON.stringify(id)};
		const had = M.list().some((m) => m.identifier === id && m.local) ||
			(M.listLocal?.() ?? []).some((r) => r?.metadata?.identifier === id);
		const out = await M.removeLocal(id);
		return JSON.stringify({ had, out: out ?? null });
	})()`,
	);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		parsed = null;
	}
	if (isRecord(parsed) && parsed.error) {
		throw new Error("the v3 loader is not staged in this client (Spicetify.Modules is absent)");
	}
	if (!isRecord(parsed) || typeof parsed.had !== "boolean") {
		throw new Error(`unexpected removeLocal result: ${raw.slice(0, 200)}`);
	}
	const out = isRecord(parsed.out) ? parsed.out : {};
	if (out.requiresRestart === true) return { kind: "requires-restart" };
	if (typeof out.revertedTo === "string") return { kind: "reverted", version: out.revertedTo };
	return parsed.had ? { kind: "removed" } : { kind: "none" };
}

export function formatRemoveOutcome(id: string, outcome: RemoveOutcome): string {
	switch (outcome.kind) {
		case "none":
			return `${id} has no local override to remove`;
		case "removed":
			return `removed the local override of ${id} (no staged copy, so it is no longer installed)`;
		case "reverted":
			return `removed the local override of ${id}; the client is back on the installed ${outcome.version}`;
		case "requires-restart":
			return `removed the local override of ${id}; restart Spotify to finish reverting it`;
	}
}

// Turn the raw client-side push result into an honest, actionable line.
export function formatPushResult(raw: string): { ok: boolean; message: string } {
	let parsed: {
		error?: string;
		loaded?: boolean;
		failed?: string | null;
		stamp?: "live" | "stale" | "unstamped";
		hadPrevious?: boolean;
		reenabled?: boolean;
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
	const remount =
		(parsed.hadPrevious
			? " — UI mounted before the push may still be the old build; re-navigate to its surface to remount"
			: "") + (parsed.reenabled ? " (it was disabled in the client; the push turned it back on)" : "");
	if (parsed.stamp === "live") return { ok: true, message: `loaded, pushed build verified executing${remount}` };
	// css-only records carry no executable entry to stamp.
	if (parsed.stamp === "unstamped") return { ok: true, message: `loaded (css-only, no execution stamp)${remount}` };
	return { ok: true, message: "loaded" };
}
