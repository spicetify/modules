/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Two copies of semver precedence exist because one runs in Node (deciding
// what may be published) and one runs in the client (deciding what to
// install). A divergence means the store resolves a version the registry
// never validated, so they are held to each other here.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import { compareVersions as inRegistry } from "../../scripts/validate-submission.ts";
import { compareVersions as inStore, satisfiesRange } from "./catalog.ts";

const CASES = [
	["1.2.0", "1.2.0"],
	["1.10.0", "1.9.0"],
	["1.2.0", "1.2.0-beta.1"],
	["1.2.0-beta.1", "1.2.0-beta.2"],
	["1.2.0-beta.10", "1.2.0-beta.2"],
	["1.2.0-alpha", "1.2.0-beta"],
	["1.2.0-beta", "1.2.0-beta.1"],
	["1.2.0+cm-1020094", "1.2.0"],
	["2.0.0", "10.0.0"],
	["0.1.0", "0.0.9"],
];

const sign = (n: number) => (n === 0 ? 0 : n > 0 ? 1 : -1);

describe("version comparator parity", () => {
	for (const [a, b] of CASES) {
		it(`agrees on ${a} vs ${b}`, () => {
			assert.equal(sign(inStore(a!, b!)), sign(inRegistry(a!, b!)));
			assert.equal(sign(inStore(b!, a!)), sign(inRegistry(b!, a!)));
		});
	}

	it("ranks a release above its prerelease in both", () => {
		assert.ok(inStore("1.2.0", "1.2.0-beta.1") > 0);
		assert.ok(inRegistry("1.2.0", "1.2.0-beta.1") > 0);
	});
});

// The range checker's other copy lives in the loader (semver-lite), which is
// what actually judges an enable; a sibling checkout carries it, so where the
// cli repo is absent this skips loudly instead of passing vacuously.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.dirname(path.dirname(path.dirname(HERE)));
const SEMVER_LITE = path.join(WORKSPACE, "cli", "src", "jsHelper", "modularLoader", "semver-lite.ts");
const SKIP = `semver-lite not found at ${path.relative(WORKSPACE, SEMVER_LITE)} - check out the cli repo beside this one`;

const loaderExports: Record<string, unknown> | null = existsSync(SEMVER_LITE)
	? await import(pathToFileURL(SEMVER_LITE).href)
	: null;
const inLoader = loaderExports?.satisfies as ((version: string, range: string) => boolean) | undefined;

const RANGE_CASES: Array<[string, string, boolean]> = [
	["1.10.0", "^1.10.0", true],
	["1.4.5", "^1.10.0", false],
	["1.10.0", "^1.4.5", true],
	["2.0.0", "^1.4.5", false],
	["0.1.2", "^0.1.0", true],
	["0.2.0", "^0.1.0", false],
	["0.1.0", "^0.1.0", true],
	["1.2.3", "~1.2.0", true],
	["1.3.0", "~1.2.0", false],
	["1.2.3", "*", true],
	["1.2.3", ">=1.0.0 <2.0.0", true],
	["2.0.0", ">=1.0.0 <2.0.0", false],
	["1.0.0", "1.0.0", true],
	["1.0.1", "1.0.0", false],
	["1.0.0+cm-1020094", "^1.0.0", true],
	["1.2.3", "1.x", true],
	["2.0.0", "1.x", false],
	["1.2.9", "1.2.x", true],
	["2.1.0", "^1.0.0 || ^2.0.0", true],
	["3.0.0", "^1.0.0 || ^2.0.0", false],
	["1.2.3", "^1", true],
	["2.0.0", "^1", false],
	["1.2.3", "~1", true],
	["1.2.3", "^1.x", true],
	["0.0.3", "^0.0.3", true],
	["0.0.4", "^0.0.3", false],
	["1.2.3", ">1.2.3", false],
	["1.2.4", ">1.2.3", true],
];

describe("range satisfaction", () => {
	for (const [version, range, expected] of RANGE_CASES) {
		it(`${version} against ${range} is ${expected}`, () => {
			assert.equal(satisfiesRange(version, range), expected);
		});
	}

	it("is unsatisfied by malformed input instead of throwing", () => {
		assert.equal(satisfiesRange("not-a-version", "^1.0.0"), false);
	});
});

describe("range satisfaction parity with the client loader", () => {
	it("semver-lite still exports satisfies", (t) => {
		if (!loaderExports) return t.skip(SKIP);
		assert.equal(typeof inLoader, "function", `${SEMVER_LITE} no longer exports satisfies`);
	});

	for (const [version, range] of RANGE_CASES) {
		it(`agrees on ${version} against ${range}`, (t) => {
			if (!loaderExports) return t.skip(SKIP);
			assert.equal(satisfiesRange(version, range), inLoader!(version, range));
		});
	}
});
