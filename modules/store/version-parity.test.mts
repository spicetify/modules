/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Two copies of semver precedence exist because one runs in Node (deciding
// what may be published) and one runs in the client (deciding what to
// install). A divergence means the store resolves a version the registry
// never validated, so they are held to each other here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareVersions as inRegistry } from "../../scripts/validate-submission.ts";
import { compareVersions as inStore } from "./catalog.ts";

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
