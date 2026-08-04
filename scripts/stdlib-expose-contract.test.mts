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

// Track per-file aliases of the lazy sources (`const R = React as any`,
// `const Mine = ReactDOM`), so renaming cannot dodge the contract.
const lazyAliases = (source: string): Set<string> => {
	const aliases = new Set(LAZY_SOURCES);
	for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(React|ReactDOM|ReactDOMServer)\b/g)) {
		aliases.add(m[1]);
	}
	return aliases;
};

// Offending shapes, matched against a whitespace-normalized source so a
// formatter's line wrapping cannot hide them:
//   export const X = R.prop            (init-time snapshot)
//   export const X = (R as any).prop   (cast variant)
//   export const { x } = R             (destructured snapshot)
const findSnapshots = (source: string): string[] => {
	const aliases = [...lazyAliases(source)].map((a) => a.replace(/\$/g, "\\$")).join("|");
	const flat = source.replace(/\s+/g, " ");
	const offenders: string[] = [];
	for (const re of [
		new RegExp(`export const \\w+(?:\\s*:[^=]*)? = (?:${aliases})\\.[A-Za-z_$][\\w$]*`, "g"),
		new RegExp(`export const \\w+(?:\\s*:[^=]*)? = \\((?:${aliases}) as [^)]*\\)\\.[A-Za-z_$][\\w$]*`, "g"),
		new RegExp(`export const \\{[^}]*\\} = (?:${aliases})\\b`, "g"),
	]) {
		for (const m of flat.matchAll(re)) offenders.push(m[0].slice(0, 90));
	}
	return offenders;
};

describe("stdlib expose shims never snapshot lazy captures at module init", () => {
	const files = readdirSync(EXPOSE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));

	for (const file of files) {
		it(`${file} contains no init-time capture snapshots`, () => {
			const offenders = findSnapshots(readFileSync(path.join(EXPOSE_DIR, file), "utf8"));
			assert.deepEqual(
				offenders,
				[],
				`init-time snapshots freeze undefined when evaluated pre-capture; use export let + a capture callback, or resolve at call time:\n` +
					offenders.map((o) => `  ${file}: ${o}`).join("\n"),
			);
		});
	}

	it("catches the evasions: aliasing, wrapping, casts, destructuring", () => {
		const frozen = [
			"const Mine = React as any;\nexport const useState = Mine.useState;",
			"export const useState =\n\tReact.useState;",
			"export const x = (React as any).x;",
			"export const { useState } = React;",
		];
		for (const src of frozen) {
			assert.ok(findSnapshots(src).length > 0, `should flag: ${JSON.stringify(src)}`);
		}
		const fine = [
			"export let useState: any;\nonWebpackCaptured(() => { useState = R.useState; });",
			"export const jsx = (type: unknown) => React.createElement(type);",
			'export const Fragment: unknown = Symbol.for("spicetify.jsx.Fragment");',
		];
		for (const src of fine) {
			assert.equal(findSnapshots(src).length, 0, `should pass: ${JSON.stringify(src)}`);
		}
	});

	it("covers the expose dir (guards against the glob going stale)", () => {
		assert.ok(files.length >= 10, `expected the expose shims, found ${files.length} files`);
	});
});
