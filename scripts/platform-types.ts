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
//   node scripts/platform-types.ts
//
// Spotify must be running with --remote-debugging-port=9229. The extractor
// probes the raw wrapper surface on purpose: a diagnostic that depends on
// stdlib cannot report on the day stdlib is what broke.

import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";

const SCRIPTS = import.meta.dirname;
const ROOT = path.dirname(SCRIPTS);
const OUT = path.join(ROOT, "platform.d.ts");
const PORT = Number(process.env.SPICETIFY_CDP_PORT ?? 9229);
// The extractor caps itself at 1500 awaited probes with a 2s timeout each;
// a healthy run finishes in well under a minute.
const EVAL_TIMEOUT_MS = 5 * 60 * 1000;

// The engine stays strip-compatible (no parameter properties, enums, or
// namespaces) so plain node can also import it for tests. Top-level
// `export` keywords are dropped so the source evaluates as a classic
// script inside the page.
const engine = stripTypeScriptTypes(readFileSync(path.join(SCRIPTS, "platform-typegen.ts"), "utf8")).replace(
	/^export /gm,
	"",
);

const expression = `(async () => {
${engine}
const platform = globalThis.Spicetify?.Platform;
if (!platform) throw new Error("Spicetify.Platform is not up yet; wait for the client to finish booting");
const generator = new TypeGenerator(platform, "Platform", METHOD_TYPES);
const output = await generator.generate();
return { output, stats: generator.stats };
})()`;

type EvalResult = {
	output: string;
	stats: { types: number; invocations: number; awaits: number; limits: Record<string, boolean> };
};

async function pageTarget(): Promise<string> {
	const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
	const targets = (await res.json()) as Array<{ url?: string; webSocketDebuggerUrl?: string }>;
	const page = targets.find((t) => (t.url ?? "").includes("xpui") && t.webSocketDebuggerUrl);
	if (!page?.webSocketDebuggerUrl) {
		throw new Error(`no xpui page target on port ${PORT}; relaunch Spotify with --remote-debugging-port=${PORT}`);
	}
	return page.webSocketDebuggerUrl;
}

function evaluateInClient(wsUrl: string): Promise<EvalResult> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error(`the client did not answer within ${EVAL_TIMEOUT_MS / 1000}s`));
		}, EVAL_TIMEOUT_MS);
		ws.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error("could not connect to the client's debug socket"));
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
			const msg = JSON.parse(String(event.data)) as {
				id?: number;
				result?: {
					result?: { value?: EvalResult };
					exceptionDetails?: { exception?: { description?: string } };
				};
			};
			if (msg.id !== 1) return;
			clearTimeout(timer);
			ws.close();
			const exception = msg.result?.exceptionDetails;
			if (exception) {
				reject(new Error(exception.exception?.description ?? "the extractor threw in the client"));
				return;
			}
			const value = msg.result?.result?.value;
			if (!value?.output) {
				reject(new Error("the extractor returned no output"));
				return;
			}
			resolve(value);
		});
	});
}

const { output, stats } = await evaluateInClient(await pageTarget());
writeFileSync(OUT, `${output.trimEnd()}\n`);

const hitLimits = Object.entries(stats.limits)
	.filter(([, hit]) => hit)
	.map(([name]) => name);
console.log(
	`wrote ${path.relative(process.cwd(), OUT)}: ${stats.types} types ` +
		`(${stats.invocations} invocations, ${stats.awaits} awaited probes)`,
);
if (hitLimits.length) {
	console.warn(`WARNING: hit ${hitLimits.join(", ")} limit(s); some types degraded to unknown`);
	process.exitCode = 1;
}
