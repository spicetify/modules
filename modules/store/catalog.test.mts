/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	categoryOf,
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
	it("searchHaystack folds id, name, description, authors and tags, lowercased", () => {
		const hay = searchHaystack(
			mod({
				meta: {
					name: "Sample",
					description: "Does Things",
					authors: [{ name: "Alice" }, { name: "BOB" }],
					tags: ["theme", "Retro"],
				},
			}),
		);
		for (const needle of ["sample", "does things", "alice", "bob", "theme", "retro"]) {
			assert.ok(hay.includes(needle), `missing ${needle}`);
		}
		assert.equal(hay, hay.toLowerCase());
	});

	it("displayName falls back to the id", () => {
		assert.equal(displayName(mod()), "sample");
		assert.equal(displayName(mod({ meta: { name: "Nice Name" } })), "Nice Name");
	});

	it("categoryOf picks the single category tag and ignores the rest", () => {
		assert.equal(categoryOf(["retro", "theme", "dark"]), "theme");
		assert.equal(categoryOf(["lib"]), undefined);
		assert.equal(categoryOf(undefined), undefined);
	});

	it("displayVersion strips the classmap build-metadata suffix", () => {
		assert.equal(displayVersion("1.2.0+cm-1020094-19f856aefd5"), "1.2.0");
		assert.equal(displayVersion("1.2.0"), "1.2.0");
	});
});
