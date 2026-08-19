/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The runner hinges on one fragile transform: strip the engine's types,
// drop its top-level `export ` keywords, and evaluate the result as a
// classic script inside the client. These tests exercise that exact
// pipeline without Spotify, so an upstream engine regeneration that
// introduces a construct the transform corrupts (a default export, a
// top-level import, or an `export ` at column 0 inside a template
// literal, which the regex would silently rewrite) fails in CI instead
// of producing a quietly broken platform.d.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";

import { buildExpression } from "./platform-types.ts";

const engineSource = readFileSync(path.join(import.meta.dirname, "platform-typegen.ts"), "utf8");

describe("the engine-to-client transform", () => {
	it("only contains constructs the pipeline can carry", () => {
		assert.doesNotMatch(engineSource, /^import[\s{]/m, "a top-level import cannot run as a classic script");
		assert.doesNotMatch(engineSource, /^export default/m, "a default export would be corrupted, not stripped");
		assert.doesNotMatch(engineSource, /^export \{/m, "an export list would be corrupted, not stripped");
	});

	it("strips every top-level export and compiles as a classic script", () => {
		const expression = buildExpression(engineSource);
		assert.doesNotMatch(expression, /^export /m, "no export keyword survives");
		// Throws on a syntax error; the client's Runtime.evaluate would too,
		// but this runs in CI without Spotify.
		void new vm.Script(expression);
	});

	it("still emits export keywords in its output after the transform", async () => {
		// The regex only touches column-0 `export ` lines, and the emitter
		// builds its declarations inside template literals; if an upstream
		// edit ever puts one at column 0, the transform would silently
		// delete exports from platform.d.ts. Running the transformed code
		// end to end proves the emitted declarations kept theirs.
		const globals = globalThis as { Spicetify?: unknown };
		const hadSpicetify = "Spicetify" in globals;
		const previous = globals.Spicetify;
		globals.Spicetify = {
			Platform: { version: "0.0.0-test", getEchoAPI: () => ({ getValue: () => 42 }) },
		};
		try {
			const run = new Function(`return ${buildExpression(engineSource)}`) as () => Promise<{
				output: string;
				stats: { types: number };
			}>;
			const { output, stats } = await run();
			assert.match(output, /export interface Platform \{/);
			assert.match(output, /getEchoAPI: /);
			assert.ok(stats.types > 0);
		} finally {
			if (hadSpicetify) globals.Spicetify = previous;
			else delete globals.Spicetify;
		}
	});
});
