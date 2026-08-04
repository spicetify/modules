/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The expose-shim contract: stdlib's expose/ files bridge module code to
// webpack captures that only exist after the client boots. A module-init
// snapshot of such a capture (`export const X = Lazy.prop`) freezes
// whatever the lazy proxy returned at evaluation time - undefined, when
// anything evaluates the shim pre-capture - and stays frozen for the whole
// session. That is how Fragment froze and every fragment in every module
// rendered as React error #130 behind a blank page.
//
// Structural rather than runtime: the webpack chain needs client globals
// (CHUNKS, timers) that do not exist under node --test, so the contract is
// enforced against the source. Allowed shapes are call-time reads (wrappers,
// getters, sentinel translation) and `export let` bindings populated by a
// capture callback.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const EXPOSE_DIR = "modules/stdlib/src/expose";

// Bindings whose property reads resolve lazily (Proxy) but still SNAPSHOT
// whatever they return when read at module init.
const LAZY_SOURCES = ["React", "ReactDOM", "ReactDOMServer"];

const isSnapshotLine = (line: string): boolean => {
	// `export const X = R.prop;` / `export const X = React.prop;` where the
	// right-hand side is a bare property read off a lazy binding (aliases
	// like `const R = React as any` count as the same source).
	const m = line.match(/^export const \w+(?::[^=]+)? = ([A-Za-z_$][\w$]*)\.[A-Za-z_$]/);
	return m !== null && (LAZY_SOURCES.includes(m[1]) || /^R[A-Z]?D?$/.test(m[1]));
};

describe("stdlib expose shims never snapshot lazy captures at module init", () => {
	const files = readdirSync(EXPOSE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));

	for (const file of files) {
		it(`${file} contains no init-time capture snapshots`, () => {
			const lines = readFileSync(path.join(EXPOSE_DIR, file), "utf8").split("\n");
			const offenders = lines
				.map((line, i) => ({ line: line.trim(), n: i + 1 }))
				.filter(({ line }) => isSnapshotLine(line));
			assert.deepEqual(
				offenders,
				[],
				`init-time snapshots freeze undefined when evaluated pre-capture; use export let + a capture callback, or resolve at call time:\n` +
					offenders.map((o) => `  ${file}:${o.n}  ${o.line}`).join("\n"),
			);
		});
	}

	it("covers the expose dir (guards against the glob going stale)", () => {
		assert.ok(files.length >= 10, `expected the expose shims, found ${files.length} files`);
	});
});
