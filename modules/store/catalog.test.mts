/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	kindOf,
	compareVersions,
	deriveRepository,
	displayName,
	displayVersion,
	searchHaystack,
	type VaultModule,
} from "./catalog.ts";

const mod = (over: Partial<VaultModule> = {}): VaultModule => ({
	id: "sample",
	version: "1.0.0",
	artifacts: ["https://github.com/spicetify/modules/releases/download/sample@1.0.0/sample.zip"],
	vault: "default",
	...over,
});

describe("compareVersions", () => {
	it("orders numerically, where a string sort breaks", () => {
		assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
		assert.ok(compareVersions("1.2.0", "1.10.0") < 0);
		assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
	});

	it("ignores build metadata and pre-release suffixes for the numeric part", () => {
		assert.equal(
			compareVersions("1.0.0+cm-1020094-abc", "1.0.0+cm-1020095-def"),
			"1.0.0+cm-1020094-abc".localeCompare("1.0.0+cm-1020095-def"),
		);
		assert.ok(compareVersions("1.0.1+cm-x", "1.0.0+cm-y") > 0);
	});

	it("zero-pads missing segments", () => {
		assert.ok(compareVersions("1.0.0.1", "1.0.0") > 0);
	});
});

describe("deriveRepository", () => {
	it("prefers an explicit https repository", () => {
		assert.equal(
			deriveRepository(mod({ meta: { repository: "https://example.com/repo" } })),
			"https://example.com/repo",
		);
	});

	it("derives the repo from a github artifact url", () => {
		assert.equal(deriveRepository(mod()), "https://github.com/spicetify/modules");
	});

	it("returns null for non-github artifacts and rejects non-https repository values", () => {
		assert.equal(deriveRepository(mod({ artifacts: ["https://cdn.example.com/x.zip"] })), null);
		assert.equal(deriveRepository(mod({ artifacts: [], meta: { repository: "javascript:alert(1)" } })), null);
	});
});

describe("card derivations", () => {
	it("searchHaystack folds id, name, description, authors and kind, lowercased", () => {
		const hay = searchHaystack(
			mod({
				meta: {
					name: "Sample",
					description: "Does Things",
					authors: [{ name: "Alice" }, { name: "BOB" }],
					kind: "theme",
				},
			}),
		);
		for (const needle of ["sample", "does things", "alice", "bob", "theme"]) {
			assert.ok(hay.includes(needle), `missing ${needle}`);
		}
		assert.equal(hay, hay.toLowerCase());
	});

	it("displayName falls back to the id", () => {
		assert.equal(displayName(mod()), "sample");
		assert.equal(displayName(mod({ meta: { name: "Nice Name" } })), "Nice Name");
	});

	it("kindOf reads the declared kind", () => {
		assert.equal(kindOf({ kind: "theme" }), "theme");
		assert.equal(kindOf({ kind: "lib" }), "lib");
	});

	it("kindOf falls back to the pre-migration tag list", () => {
		// Entries published before `kind` still have to categorise, or every
		// theme in an older vault would stop offering Activate.
		assert.equal(kindOf({ tags: ["retro", "theme", "dark"] }), "theme");
		assert.equal(kindOf({ tags: ["snippet"] }), "snippet");
	});

	it("kindOf answers extension for anything it cannot place", () => {
		// Never "theme" on a guess: that would enter the module into the
		// single-theme contest and unload the user's real theme.
		assert.equal(kindOf(undefined), "extension");
		assert.equal(kindOf({}), "extension");
		assert.equal(kindOf({ kind: "nonsense" }), "extension");
		assert.equal(kindOf({ tags: ["retro", "dark"] }), "extension");
	});

	it("displayVersion strips the classmap build-metadata suffix", () => {
		assert.equal(displayVersion("1.2.0+cm-1020094-19f856aefd5"), "1.2.0");
		assert.equal(displayVersion("1.2.0"), "1.2.0");
	});
});
