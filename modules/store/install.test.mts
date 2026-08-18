/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// installedRecords and removeLocalRecord read the loader through runtime.ts's
// call-time M(), so a plain global stub is enough - no DOM harness needed.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { VaultModule } from "./catalog.ts";
import {
	enableFailureReason,
	ensureDependencies,
	installedRecords,
	installModule,
	isCustomRecord,
	removeLocalRecord,
} from "./install.ts";

type LocalRecord = {
	metadata: { identifier: string; version?: string; tags?: string[] };
	sidecar?: { installed_version?: string };
	remapKey?: string;
};

let locals: LocalRecord[] = [];
let states: Array<{ identifier: string; version: string; local: boolean }> = [];
let manifestModules: Array<Record<string, unknown>> = [];
let removeResult: unknown;
let removed: string[] = [];
let installed: string[] = [];
let installLocalImpl: (id: string) => unknown = () => true;
let reportShape: unknown;
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
			classmapKey: "cmkey",
			get modules() {
				return manifestModules;
			},
		},
		removeLocal: (id: string) => {
			removed.push(id);
			return Promise.resolve(removeResult);
		},
		installLocal: (id: string) => {
			installed.push(id);
			return Promise.resolve(installLocalImpl(id));
		},
		get report() {
			return reportShape;
		},
	},
};

const local = (id: string, version: string, remapKey?: string): LocalRecord => ({
	metadata: { identifier: id, version },
	sidecar: { installed_version: version },
	...(remapKey === undefined ? {} : { remapKey }),
});

beforeEach(() => {
	locals = [];
	states = [];
	manifestModules = [];
	removeResult = undefined;
	removed = [];
	installed = [];
	installLocalImpl = () => true;
	reportShape = undefined;
	store.clear();
});

// A vault the catalog can fetch without any network: inline (css-only)
// entries install without an artifact download, which is all these tests
// need — the dependency logic under test is loader interaction, not zips.
const vaultUrl = (modules: Record<string, unknown>, revoked: Record<string, string> = {}) =>
	`data:application/json,${encodeURIComponent(JSON.stringify({ modules, revoked }))}`;

const inlineEntry = (version: string) => ({ v: { [version]: { files: { "index.css": "/* x */" } } } });

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

describe("ensureDependencies", () => {
	it("is satisfied by the running version without touching the vault", async () => {
		// A fetch here would hit the garbage URL and make the vault look empty.
		store.set("spicetify:defaultVaultUrl", "data:text/plain,garbage");
		states = [{ identifier: "stdlib", version: "1.10.0", local: false }];
		const out = await ensureDependencies({ stdlib: "^1.10.0" }, () => {});
		assert.deepEqual(out, { requiresRestart: false });
		assert.deepEqual(installed, []);
	});

	it("is satisfied through a compat version the running copy vouches for", async () => {
		store.set("spicetify:defaultVaultUrl", "data:text/plain,garbage");
		states = [{ identifier: "stdlib", version: "2.0.0", local: false }];
		manifestModules = [{ identifier: "stdlib", version: "2.0.0", compat: ["1.4.5"] }];
		const out = await ensureDependencies({ stdlib: "^1.4.0" }, () => {});
		assert.deepEqual(out, { requiresRestart: false });
		assert.deepEqual(installed, []);
	});

	it("treats a satisfying restart-pending record as restart-gated, not reinstallable", async () => {
		store.set("spicetify:defaultVaultUrl", "data:text/plain,garbage");
		states = [{ identifier: "stdlib", version: "1.4.5", local: false }];
		locals = [local("stdlib", "1.10.0", "cmkey")];
		const out = await ensureDependencies({ stdlib: "^1.10.0" }, () => {});
		assert.deepEqual(out, { requiresRestart: true });
		assert.deepEqual(installed, [], "the pending copy is not downloaded again");
	});

	it("ignores a pending record the loader's localWins rule will refuse", async () => {
		// Remapped against another boot's classmap: staged wins on restart, so
		// counting this record would promise a restart that changes nothing.
		store.set("spicetify:defaultVaultUrl", "data:text/plain,garbage");
		states = [{ identifier: "stdlib", version: "1.4.5", local: false }];
		locals = [local("stdlib", "1.10.0", "stale-key")];
		await assert.rejects(
			() => ensureDependencies({ stdlib: "^1.10.0" }, () => {}),
			/could not be reached/,
			"falls through to the vault instead of trusting the record",
		);
	});

	it("brings an unsatisfied dependency up from the vault before the dependent", async () => {
		store.set("spicetify:defaultVaultUrl", vaultUrl({ dep: inlineEntry("2.0.0") }));
		states = [{ identifier: "dep", version: "1.0.0", local: false }];
		installLocalImpl = () => {
			states = [{ identifier: "dep", version: "2.0.0", local: true }];
			return true;
		};
		const out = await ensureDependencies({ dep: "^2.0.0" }, () => {});
		assert.deepEqual(installed, ["dep"]);
		assert.deepEqual(out, { requiresRestart: false }, "the dependency came up live");
	});

	it("reports restart-gated when the dependency only applies on the next boot", async () => {
		// A tree module's update returns requiresRestart and the registry
		// keeps the old version, so the dependent cannot enable this session.
		store.set("spicetify:defaultVaultUrl", vaultUrl({ stdlib: inlineEntry("1.10.0") }));
		states = [{ identifier: "stdlib", version: "1.4.5", local: false }];
		installLocalImpl = () => ({ requiresRestart: true });
		const out = await ensureDependencies({ stdlib: "^1.10.0" }, () => {});
		assert.deepEqual(installed, ["stdlib"]);
		assert.deepEqual(out, { requiresRestart: true });
	});

	it("refuses before anything persists when the vault cannot provide the range", async () => {
		store.set("spicetify:defaultVaultUrl", vaultUrl({ stdlib: inlineEntry("1.4.5") }));
		states = [];
		await assert.rejects(
			() => ensureDependencies({ stdlib: "^1.10.0" }, () => {}),
			/needs stdlib@\^1\.10\.0; the vault's newest is 1\.4\.5/,
		);
		assert.deepEqual(installed, []);
	});

	it("names an unreachable vault instead of claiming it cannot provide", async () => {
		store.set("spicetify:defaultVaultUrl", "data:text/plain,garbage");
		states = [];
		await assert.rejects(() => ensureDependencies({ stdlib: "^1.10.0" }, () => {}), /could not be reached/);
	});

	it("never auto-installs a revoked dependency", async () => {
		store.set("spicetify:defaultVaultUrl", vaultUrl({ stdlib: inlineEntry("1.10.0") }, { stdlib: "pulled" }));
		states = [];
		await assert.rejects(() => ensureDependencies({ stdlib: "^1.10.0" }, () => {}), /revoked: pulled/);
		assert.deepEqual(installed, []);
	});
});

describe("installModule", () => {
	it("joins an in-flight install of the same id instead of reporting completion", async () => {
		// Two cards racing on a shared dependency: the second caller must wait
		// for the real install, not return early with nothing installed.
		const mod: VaultModule = {
			id: "dep",
			version: "1.0.0",
			artifacts: [],
			files: { "index.css": "/* x */" },
			vault: "test",
		};
		await Promise.all([installModule(mod, () => {}), installModule(mod, () => {})]);
		assert.deepEqual(installed, ["dep"], "one install, both callers resolved after it");
	});
});

describe("enableFailureReason", () => {
	it("reads the failure map when report is a plain object", () => {
		reportShape = { failed: { mod: "needs stdlib@^1.10.0, installed is 1.4.5" } };
		assert.equal(enableFailureReason("mod"), "needs stdlib@^1.10.0, installed is 1.4.5");
	});

	it("reads the failure map when report is a function", () => {
		// Some loader builds expose Modules.report as a callable.
		reportShape = () => ({ failed: { mod: "boom" } });
		assert.equal(enableFailureReason("mod"), "boom");
	});

	it("falls back when no reason was recorded", () => {
		reportShape = { failed: {} };
		assert.equal(enableFailureReason("mod"), "unknown reason");
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
