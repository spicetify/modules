/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// pendingUpdates reads the loader through runtime.ts's call-time M(), so a
// plain global stub is enough - no DOM harness needed.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { Catalog, VaultModule } from "./catalog.ts";
import { pendingUpdates } from "./updates.ts";

type LocalRecord = {
	metadata: { identifier: string; tags?: string[]; dependencies?: Record<string, string> };
	sidecar?: { installed_version?: string };
};

let locals: LocalRecord[] = [];
let stagedStates: Array<{ identifier: string; version: string; local: boolean }> = [];
let manifestModules: Array<Record<string, unknown>> = [];
(globalThis as never as Record<string, unknown>).Spicetify = {
	Modules: {
		listLocal: () => locals,
		list: () => stagedStates,
		manifest: {
			get modules() {
				return manifestModules;
			},
		},
	},
};

const entry = (id: string, version: string): VaultModule => ({ id, version, artifacts: ["x"], vault: "default" });
const catalog = (modules: VaultModule[], revoked: Record<string, string> = {}): Catalog => ({
	modules,
	revoked,
	ok: true,
});

beforeEach(() => {
	locals = [];
	stagedStates = [];
	manifestModules = [];
});

describe("pendingUpdates", () => {
	it("lists installed modules whose vault version differs", () => {
		locals = [
			{ metadata: { identifier: "a" }, sidecar: { installed_version: "1.0.0" } },
			{ metadata: { identifier: "b" }, sidecar: { installed_version: "2.0.0" } },
		];
		const out = pendingUpdates(catalog([entry("a", "1.1.0"), entry("b", "2.0.0")]));
		assert.deepEqual(
			out.map((m) => m.id),
			["a"],
		);
	});

	it("ignores modules that are not installed locally", () => {
		locals = [{ metadata: { identifier: "a" }, sidecar: { installed_version: "1.0.0" } }];
		assert.deepEqual(pendingUpdates(catalog([entry("stranger", "9.9.9")])), []);
	});

	it("never updates revoked or user-authored custom modules", () => {
		locals = [
			{ metadata: { identifier: "revoked-one" }, sidecar: { installed_version: "1.0.0" } },
			{ metadata: { identifier: "mine", tags: ["custom"] }, sidecar: { installed_version: "0.1.0" } },
		];
		const out = pendingUpdates(
			catalog([entry("revoked-one", "1.1.0"), entry("mine", "0.2.0")], { "revoked-one": "bad" }),
		);
		assert.deepEqual(out, []);
	});

	it("includes CLI-staged modules, comparing against the running version", () => {
		stagedStates = [{ identifier: "cli-mod", version: "1.0.0", local: false }];
		manifestModules = [{ identifier: "cli-mod", version: "1.0.0" }];
		const out = pendingUpdates(catalog([entry("cli-mod", "1.1.0")]));
		assert.deepEqual(
			out.map((m) => m.id),
			["cli-mod"],
		);
	});

	it("never offers a staged module an older vault version (it would be shadowed)", () => {
		stagedStates = [{ identifier: "ahead", version: "1.2.0", local: false }];
		manifestModules = [{ identifier: "ahead", version: "1.2.0" }];
		assert.deepEqual(pendingUpdates(catalog([entry("ahead", "1.1.0")])), []);
	});

	it("still offers a local record any differing vault version", () => {
		locals = [{ metadata: { identifier: "rollback" }, sidecar: { installed_version: "1.2.0" } }];
		const out = pendingUpdates(catalog([entry("rollback", "1.1.0")]));
		assert.deepEqual(
			out.map((m) => m.id),
			["rollback"],
		);
	});

	it("prefers the local record when a module is both local and staged", () => {
		locals = [{ metadata: { identifier: "both" }, sidecar: { installed_version: "1.1.0" } }];
		stagedStates = [{ identifier: "both", version: "1.0.0", local: true }];
		manifestModules = [{ identifier: "both", version: "1.0.0" }];
		assert.deepEqual(pendingUpdates(catalog([entry("both", "1.1.0")])), []);
	});

	it("orders dependencies before dependents so mid-batch enables never race", () => {
		locals = [
			{
				metadata: { identifier: "app", dependencies: { lib: "^1.0.0" } },
				sidecar: { installed_version: "1.0.0" },
			},
			{ metadata: { identifier: "lib" }, sidecar: { installed_version: "1.0.0" } },
		];
		const out = pendingUpdates(catalog([entry("app", "1.1.0"), entry("lib", "1.1.0")]));
		assert.deepEqual(
			out.map((m) => m.id),
			["lib", "app"],
		);
	});
});
