/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Regenerates platform.d.ts, the committed snapshot of Spotify's Platform
// API surface for the build we develop against. Compiles the extractor
// (scripts/platform-typegen.ts) to plain JS, evaluates it in the
// debug-port client against window.Spicetify.Platform, and writes the
// emitted declarations to the repo root, where kit's sync-vendor ships
// them to module authors. Run it per Spotify build, like theme-report:
//
//   node scripts/platform-types.ts [--force]
//
// Spotify must be running with --remote-debugging-port=9229. The extractor
// probes the raw wrapper surface on purpose: a diagnostic that depends on
// stdlib cannot report on the day stdlib is what broke. A run that hits
// the extractor's internal limits refuses to overwrite the snapshot with
// degraded output unless --force is passed, and a rerun whose only change
// is the timestamp header leaves the file untouched, so a committed diff
// always means the API surface actually moved.

import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = import.meta.dirname;
const ROOT = path.dirname(SCRIPTS);
const OUT = path.join(ROOT, "platform.d.ts");
const PORT = Number(process.env.SPICETIFY_CDP_PORT ?? 9229);
// The extractor races its awaited probes against one shared 2s window, so
// a healthy run finishes in well under a minute; the margin is for a
// wedged client, not for the probes.
const EVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The whole client-side payload: the engine compiled to plain JS, its
 * top-level `export ` keywords dropped so it evaluates as a classic
 * script, and an entry that runs it against the live Platform. The engine
 * stays strip-compatible (no parameter properties, enums, or namespaces)
 * so plain node can also import it for tests.
 */
export function buildExpression(engineSource: string): string {
	const engine = stripTypeScriptTypes(engineSource).replace(/^export /gm, "");
	return `(async () => {
${engine}
const platform = globalThis.Spicetify?.Platform;
if (!platform) throw new Error("Spicetify.Platform is not up yet; wait for the client to finish booting");
const generator = new TypeGenerator(platform, "Platform", METHOD_TYPES);
const output = await generator.generate();
return { output, stats: generator.stats };
})()
//# sourceURL=platform-typegen.ts`;
}

type EvalResult = {
	output: string;
	stats: {
		types: number;
		invocations: number;
		awaits: number;
		limits: { nodes: boolean; invocations: boolean; awaits: boolean };
	};
};

async function pageTarget(): Promise<string> {
	let targets: Array<{ url?: string; webSocketDebuggerUrl?: string }>;
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		targets = (await res.json()) as typeof targets;
	} catch (cause) {
		throw new Error(`no debugger on port ${PORT}; relaunch Spotify with --remote-debugging-port=${PORT}`, {
			cause,
		});
	}
	const page = targets.find((t) => (t.url ?? "").includes("xpui") && t.webSocketDebuggerUrl);
	if (!page?.webSocketDebuggerUrl) {
		throw new Error(`no xpui page target on port ${PORT}; is the client still starting up?`);
	}
	return page.webSocketDebuggerUrl;
}

function evaluateInClient(wsUrl: string, expression: string): Promise<EvalResult> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error(`the client did not answer within ${EVAL_TIMEOUT_MS / 1000}s`));
		}, EVAL_TIMEOUT_MS);
		const settle = (fn: () => void) => {
			clearTimeout(timer);
			ws.close();
			fn();
		};
		ws.addEventListener("error", (event) => {
			settle(() =>
				reject(
					new Error("could not connect to the client's debug socket", {
						cause: (event as ErrorEvent).error ?? event,
					}),
				),
			);
		});
		ws.addEventListener("close", (event) => {
			// Settling is idempotent; this only bites when the target died
			// before answering (Spotify quit, the page navigated away).
			reject(new Error(`the debug socket closed (code ${event.code}) before the extractor answered`));
			clearTimeout(timer);
		});
		ws.addEventListener("open", () => {
			ws.send(
				JSON.stringify({
					id: 1,
					method: "Runtime.evaluate",
					params: {
						expression,
						awaitPromise: true,
						returnByValue: true,
						allowUnsafeEvalBlockedByCSP: true,
					},
				}),
			);
		});
		ws.addEventListener("message", (event) => {
			if (typeof event.data !== "string") return;
			let msg: {
				id?: number;
				error?: { code: number; message: string };
				result?: {
					result?: { value?: EvalResult };
					exceptionDetails?: { text?: string; exception?: { description?: string } };
				};
			};
			try {
				msg = JSON.parse(event.data) as typeof msg;
			} catch (cause) {
				settle(() => reject(new Error("unparseable CDP frame", { cause })));
				return;
			}
			if (msg.id !== 1) return;
			if (msg.error) {
				const { code, message } = msg.error;
				settle(() => reject(new Error(`CDP error ${code}: ${message}`)));
				return;
			}
			const exception = msg.result?.exceptionDetails;
			if (exception) {
				const detail = exception.exception?.description ?? exception.text ?? JSON.stringify(exception);
				settle(() => reject(new Error(detail)));
				return;
			}
			const value = msg.result?.result?.value;
			if (typeof value?.output !== "string" || !value.stats?.limits) {
				settle(() => reject(new Error("the extractor returned an unexpected shape")));
				return;
			}
			settle(() => resolve(value));
		});
	});
}

// A rerun against an unchanged client should not churn the snapshot: the
// header timestamp is the only thing guaranteed to differ, so it is
// ignored for the comparison and the old file (old stamp included) wins.
const HEADER_LINE = /^\/\/ Auto-generated at .*$/m;

function writeSnapshot(output: string): "written" | "unchanged" {
	const next = `${output.trimEnd()}\n`;
	let previous = "";
	try {
		previous = readFileSync(OUT, "utf8");
	} catch {
		/* first generation */
	}
	if (previous && previous.replace(HEADER_LINE, "") === next.replace(HEADER_LINE, "")) {
		return "unchanged";
	}
	writeFileSync(OUT, next);
	return "written";
}

async function main(): Promise<void> {
	const engineSource = readFileSync(path.join(SCRIPTS, "platform-typegen.ts"), "utf8");
	const { output, stats } = await evaluateInClient(await pageTarget(), buildExpression(engineSource));

	const hitLimits = Object.entries(stats.limits)
		.filter(([, hit]) => hit)
		.map(([name]) => name);
	if (hitLimits.length && !process.argv.includes("--force")) {
		console.error(
			`refusing to write: hit ${hitLimits.join(", ")} limit(s), so parts of the output degraded ` +
				`to unknown; rerun with --force to keep the degraded snapshot`,
		);
		process.exitCode = 1;
		return;
	}

	// Platform populates progressively during boot, so a too-early run
	// yields a plausible but truncated surface with no limit flagged. A
	// shrink past what any real API removal could explain is that, not
	// drift.
	let previousTypes = 0;
	try {
		previousTypes = (readFileSync(OUT, "utf8").match(/^(export )?(interface|type) /gm) ?? []).length;
	} catch {
		/* first generation */
	}
	if (previousTypes && stats.types < previousTypes * 0.8 && !process.argv.includes("--force")) {
		console.error(
			`refusing to write: only ${stats.types} types against a snapshot of ${previousTypes}; ` +
				`the client is probably still booting (rerun with --force to override)`,
		);
		process.exitCode = 1;
		return;
	}

	const outcome = writeSnapshot(output);
	const relative = path.relative(process.cwd(), OUT);
	console.log(
		outcome === "unchanged"
			? `${relative} unchanged: the Platform surface did not move (${stats.types} types)`
			: `wrote ${relative}: ${stats.types} types (${stats.invocations} invocations, ${stats.awaits} awaited probes)`,
	);
	if (hitLimits.length) {
		console.warn(`WARNING: hit ${hitLimits.join(", ")} limit(s); the kept snapshot is degraded`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
