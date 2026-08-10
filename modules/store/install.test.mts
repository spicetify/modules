/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// installedRecords and removeLocalRecord read the loader through runtime.ts's
// call-time M(), so a plain global stub is enough - no DOM harness needed.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { installedRecords, isCustomRecord, removeLocalRecord } from "./install.ts";

type LocalRecord = {
	metadata: { identifier: string; version?: string; tags?: string[] };
	sidecar?: { installed_version?: string };
};

let locals: LocalRecord[] = [];
let states: Array<{ identifier: string; version: string; local: boolean }> = [];
let manifestModules: Array<Record<string, unknown>> = [];
let removeResult: unknown;
let removed: string[] = [];
const store = new Map<string, string>();

(globalThis as never as Record<string, unknown>).localStorage = {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
	removeItem: (k: string) => store.delete(k),
};
(globalThis as never as Record<string, unknown>).Spicetify = {
	Modules: {
		listLocal: () => locals,
		list: () => states,
		manifest: {
			get modules() {
				return manifestModules;
			},
		},
		removeLocal: (id: string) => {
			removed.push(id);
			return Promise.resolve(removeResult);
		},
	},
};

const local = (id: string, version: string): LocalRecord => ({
	metadata: { identifier: id, version },
	sidecar: { installed_version: version },
});

beforeEach(() => {
	locals = [];
	states = [];
	manifestModules = [];
	removeResult = undefined;
	removed = [];
	store.clear();
});

describe("installedRecords", () => {
	it("reports a live local override as the local install", () => {
		locals = [local("mod", "1.1.0")];
		states = [{ identifier: "mod", version: "1.1.0", local: true }];
		const [record] = installedRecords();
		assert.equal(record!.local, true);
		assert.equal(record!.shadowedLocal, undefined);
	});

	it("surfaces a shadowed record on the staged row instead of dropping it", () => {
		// The loader refused the record (localWins), so the staged copy runs.
		// Before this, the record had no row anywhere and only a full store
		// reset could clear it.
		locals = [local("mod", "1.0.0")];
		states = [{ identifier: "mod", version: "1.2.0", local: false }];
		manifestModules = [{ identifier: "mod", version: "1.2.0", name: "Mod" }];
		const records = installedRecords();
		assert.equal(records.length, 1, "one row per module, not two");
		assert.equal(records[0]!.local, false);
		assert.equal(records[0]!.sidecar.installed_version, "1.2.0", "the running version");
		assert.equal(records[0]!.shadowedLocal, "1.0.0", "the inert one is named");
	});

	it("leaves a staged install with no record alone", () => {
		states = [{ identifier: "mod", version: "1.0.0", local: false }];
		manifestModules = [{ identifier: "mod", version: "1.0.0" }];
		assert.equal(installedRecords()[0]!.shadowedLocal, undefined);
	});
});

describe("removeLocalRecord", () => {
	it("reports a real removal plainly", async () => {
		assert.equal(await removeLocalRecord("mod", "Mod"), "Mod removed");
		assert.deepEqual(removed, ["mod"]);
	});

	it("says the module is still installed when the loader reverted to staged", async () => {
		// The regression this whole change exists for: Remove used to print
		// "removed" while the CLI-staged copy carried on running.
		removeResult = { revertedTo: "0.1.0" };
		assert.equal(
			await removeLocalRecord("hide-window-controls", "Hide window controls"),
			"Hide window controls: store copy removed, still installed via the CLI at 0.1.0",
		);
	});

	it("says a restart is needed for a tree module", async () => {
		removeResult = { requiresRestart: true };
		assert.equal(await removeLocalRecord("stdlib", "stdlib"), "stdlib removed — restart Spotify to finish");
	});

	it("drops the active-theme pointer only when the theme is really gone", async () => {
		store.set("spicetify:modules:activeTheme", "theme");
		states = [];
		await removeLocalRecord("theme", "Theme");
		assert.equal(store.get("spicetify:modules:activeTheme"), undefined);

		store.set("spicetify:modules:activeTheme", "theme");
		states = [{ identifier: "theme", version: "0.1.0", local: false }];
		removeResult = { revertedTo: "0.1.0" };
		await removeLocalRecord("theme", "Theme");
		assert.equal(store.get("spicetify:modules:activeTheme"), "theme", "the staged theme still runs");
	});
});

describe("isCustomRecord", () => {
	it("recognises the new custom boolean", () => {
		assert.equal(isCustomRecord({ custom: true }), true);
	});

	it("recognises the legacy custom tag, so pre-migration snippets are still user-authored", () => {
		// Every snippet created before the custom-boolean migration carries the
		// marker in the tag list; dropping this fallback hid their Edit button
		// and exposed them to vault-driven updates over the user's own CSS.
		assert.equal(isCustomRecord({ tags: ["snippet", "custom"] }), true);
	});

	it("is false for a vault-managed module", () => {
		assert.equal(isCustomRecord({ kind: "extension", tags: ["extension"] } as never), false);
		assert.equal(isCustomRecord(undefined), false);
		assert.equal(isCustomRecord({}), false);
	});
});
