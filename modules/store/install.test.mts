/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// installedRecords and removeLocalRecord read the loader through runtime.ts's
// call-time M(), so a plain global stub is enough - no DOM harness needed.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { VaultModule } from "./catalog.ts";
import {
	enableFailureReason,
	ensureDependencies,
	installedRecords,
	installModule,
	isCustomRecord,
	removeLocalRecord,
	stageStdlibViaDaemon,
} from "./install.ts";

type LocalRecord = {
	metadata: { identifier: string; version?: string; tags?: string[]; kind?: string };
	sidecar?: { installed_version?: string };
	remapKey?: string;
};

let locals: LocalRecord[] = [];
let states: Array<{ identifier: string; version: string; local: boolean; loaded?: boolean }> = [];
let manifestModules: Array<Record<string, unknown>> = [];
let removeResult: unknown;
let removed: string[] = [];
let installed: string[] = [];
let installOptions: unknown[] = [];
let installLocalImpl: (id: string) => unknown = () => true;
let enableImpl: (id: string) => boolean | Promise<boolean> = () => true;
let enabled: string[] = [];
let unloaded: string[] = [];
let toasts: string[] = [];
let reportShape: unknown;
const store = new Map<string, string>();

(globalThis as never as Record<string, unknown>).localStorage = {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
	removeItem: (k: string) => store.delete(k),
};
(globalThis as never as Record<string, unknown>).Spicetify = {
	showNotification: (message: string) => void toasts.push(message),
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
		installLocal: (id: string, _record: unknown, options?: unknown) => {
			installed.push(id);
			installOptions.push(options);
			return Promise.resolve(installLocalImpl(id));
		},
		enable: (id: string) => {
			enabled.push(id);
			return Promise.resolve(enableImpl(id));
		},
		unload: (id: string) => {
			unloaded.push(id);
			return Promise.resolve(true);
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
	installOptions = [];
	installLocalImpl = () => true;
	enableImpl = () => true;
	enabled = [];
	unloaded = [];
	toasts = [];
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

describe("stageStdlibViaDaemon", () => {
	const spicetify = (globalThis as never as Record<string, any>).Spicetify;
	const noStatus = () => {};
	const stdlibMod = (version: string): VaultModule => ({
		id: "stdlib",
		version,
		artifacts: ["https://example.com/stdlib.zip"],
		vault: "default",
	});

	beforeEach(() => {
		spicetify.Daemon = undefined;
	});

	it("declines when the wrapper cannot both stage and apply", async () => {
		// Staging through a send-only wrapper would latch a hold whose
		// Apply button can never render.
		spicetify.Daemon = { available: () => Promise.resolve(true), send: () => Promise.resolve("ok") };
		assert.equal(await stageStdlibViaDaemon(stdlibMod("1.10.1"), noStatus), "unavailable");
		assert.equal(localStorage.getItem("spicetify:store:stdlibDiskStaged"), null);
	});

	it("stages once and stores the plain semver even for a +cm vault key", async () => {
		// The running version after an apply is the module's own
		// metadata.json version, which never carries build metadata.
		const sent: string[] = [];
		spicetify.Daemon = {
			available: () => Promise.resolve(true),
			send: (uri: string) => {
				sent.push(uri);
				return Promise.resolve("ok");
			},
			apply: () => Promise.resolve(),
		};
		assert.equal(await stageStdlibViaDaemon(stdlibMod("1.10.1+cm-1020096-abc"), noStatus), "staged");
		assert.equal(localStorage.getItem("spicetify:store:stdlibDiskStaged"), "1.10.1");
		assert.match(sent[0], /fast-enable/);
		assert.equal(await stageStdlibViaDaemon(stdlibMod("1.10.1+cm-1020096-abc"), noStatus), "already-staged");
		assert.equal(sent.length, 1);
	});

	it("reports a dispatched-but-unanswered request as pending, without the marker", async () => {
		// The daemon keeps working after the socket dies, so the record
		// path must not run and stage the same version twice.
		spicetify.Daemon = {
			available: () => Promise.resolve(true),
			send: () => Promise.reject(new Error("daemon did not answer spicetify:stdlib:fast-enable within 15000ms")),
			apply: () => Promise.resolve(),
		};
		assert.equal(await stageStdlibViaDaemon(stdlibMod("1.10.1"), noStatus), "pending");
		assert.equal(localStorage.getItem("spicetify:store:stdlibDiskStaged"), null);
	});

	it("degrades to the record path on an error reply", async () => {
		spicetify.Daemon = {
			available: () => Promise.resolve(true),
			send: () => Promise.reject(new Error("registry-verified artifact required")),
			apply: () => Promise.resolve(),
		};
		assert.equal(await stageStdlibViaDaemon(stdlibMod("1.10.1"), noStatus), "unavailable");
		assert.equal(localStorage.getItem("spicetify:store:stdlibDiskStaged"), null);
	});
});

describe("a hung live swap", () => {
	it("declares the update restart-gated instead of pinning installing forever", async (t) => {
		// The loader saves the record before unloading the old instance, so
		// a dispose that never settles (seen live: adblock's unbounded slot
		// restorer) leaves a durable update that only needs a restart.
		t.mock.timers.enable({ apis: ["setTimeout"] });
		installLocalImpl = () => new Promise(() => {});
		const outcome = installModule(
			{ id: "adblock", version: "0.1.8", artifacts: [], vault: "default", files: { "index.css": "/* x */" } },
			() => {},
		);
		// Let the async install reach the watchdog's setTimeout before the
		// fake clock advances; the inline path is microtask-only up to it.
		for (let i = 0; i < 25; i++) await Promise.resolve();
		t.mock.timers.tick(15_001);
		assert.deepEqual(await outcome, { requiresRestart: true, enabled: false });
	});
});

describe("updating a theme that is not active", () => {
	const ACTIVE = "spicetify:modules:activeTheme";
	const theme = (id: string, version: string): LocalRecord => ({
		metadata: { identifier: id, version, kind: "theme" },
		sidecar: { installed_version: version },
	});
	const update = (id: string) =>
		installModule(
			{ id, version: "0.2.0", artifacts: [], vault: "default", files: { "index.css": "/* x */" } },
			() => {},
		);
	const loaded = () => states.filter((s) => s.loaded).map((s) => s.identifier);
	// The loader's enable(): load the theme, unload any other, and remember
	// it as the active one.
	const loadTheme = (id: string) => {
		for (const s of states) s.loaded = s.identifier === id;
		store.set(ACTIVE, id);
		return true;
	};

	beforeEach(() => {
		locals = [theme("text", "1.0.0"), theme("starry-night", "0.1.4")];
		states = [
			{ identifier: "text", version: "1.0.0", local: true, loaded: true },
			{ identifier: "starry-night", version: "0.1.4", local: true, loaded: false },
		];
		store.set(ACTIVE, "text");
		installLocalImpl = loadTheme;
		enableImpl = loadTheme;
	});

	it("keeps the active theme running and preferred", async () => {
		assert.deepEqual(await update("starry-night"), { requiresRestart: false, enabled: false });
		assert.deepEqual(loaded(), ["text"]);
		assert.equal(store.get(ACTIVE), "text");
		assert.deepEqual(toasts, ["starry-night updated; text is still the active theme"]);
	});

	it("keeps a boot fallback's missing preference missing", async () => {
		// text booted as the last eligible theme, with nothing saved; saving it
		// now would change what a later boot picks.
		store.delete(ACTIVE);
		await update("starry-night");
		assert.deepEqual(loaded(), ["text"]);
		assert.equal(store.get(ACTIVE), undefined);
	});

	it("asks the loader to keep the theme unloaded, and trusts a loader that does", async () => {
		installLocalImpl = () => ({ inactive: true });
		assert.deepEqual(await update("starry-night"), { requiresRestart: false, enabled: false });
		assert.deepEqual(installOptions, [{ keepInactive: true }]);
		assert.deepEqual(enabled, [], "nothing was switched, so nothing is reloaded");
		assert.deepEqual(loaded(), ["text"]);
		assert.deepEqual(toasts, ["starry-night updated; text is still the active theme"]);
	});

	it("keeps the active theme across queued updates on a loader that switches", async () => {
		locals.push(theme("nord", "0.1.0"));
		states.push({ identifier: "nord", version: "0.1.0", local: true, loaded: false });
		// Reloading the previous theme takes real time, as it does in the client.
		enableImpl = (id) => new Promise((resolve) => setTimeout(() => resolve(loadTheme(id)), 0));
		await Promise.all([update("starry-night"), update("nord")]);
		assert.deepEqual(loaded(), ["text"]);
		assert.equal(store.get(ACTIVE), "text");
	});

	it("leaves the client unthemed when no theme was on", async () => {
		states[0].loaded = false;
		await update("starry-night");
		assert.deepEqual(unloaded, ["starry-night"]);
		assert.equal(store.get(ACTIVE), "text", "the boot preference is the one from before the update");
		assert.deepEqual(enabled, []);
	});

	it("puts the active theme back when the update fails to load", async () => {
		installLocalImpl = () => {
			for (const s of states) s.loaded = false;
			return false;
		};
		await update("starry-night");
		assert.deepEqual(enabled, ["text"]);
		assert.deepEqual(loaded(), ["text"]);
	});

	it("does not reload an active theme the failed load never unloaded", async () => {
		installLocalImpl = () => false;
		await update("starry-night");
		assert.deepEqual(enabled, [], "enable() refuses a loaded module, which would read as a failure");
		assert.ok(!toasts.some((t) => t.includes("did not reload")));
	});

	it("loads an update to the running theme as before", async () => {
		assert.deepEqual(await update("text"), { requiresRestart: false, enabled: true });
		assert.deepEqual(enabled, []);
		assert.deepEqual(installOptions, [undefined]);
	});

	it("loads an update to the preferred theme, which may fix why it did not come up", async () => {
		states[0].loaded = false;
		store.set(ACTIVE, "starry-night");
		assert.deepEqual(await update("starry-night"), { requiresRestart: false, enabled: true });
		assert.deepEqual(loaded(), ["starry-night"]);
	});

	it("activates a theme installed for the first time", async () => {
		assert.deepEqual(await update("nord"), { requiresRestart: false, enabled: true });
		assert.deepEqual(enabled, []);
	});
});

describe("a stdlib update staged during a module update", () => {
	beforeEach(() => {
		states = [
			{ identifier: "stdlib", version: "1.0.0", local: false, loaded: true },
			{ identifier: "lyrics-plus", version: "0.3.0", local: true, loaded: true },
		];
		locals = [local("lyrics-plus", "0.3.0"), local("stdlib", "1.1.0")];
	});
	const update = (id: string) =>
		installModule(
			{ id, version: "0.4.0", artifacts: [], vault: "default", files: { "index.css": "/* x */" } },
			() => {},
		);

	it("holds the swap of an installed module", async () => {
		await assert.rejects(update("lyrics-plus"), /a stdlib update is staged/);
		assert.deepEqual(installed, []);
	});

	it("does not hold a fresh install", async () => {
		await update("adblock");
		assert.deepEqual(installed, ["adblock"]);
	});
});

describe("swaps and stdlib commits", () => {
	const spicetify = (globalThis as never as Record<string, any>).Spicetify;
	const MARKER = "spicetify:store:stdlibDiskStaged";
	const inline = (id: string, version: string): VaultModule => ({
		id,
		version,
		artifacts: [],
		vault: "default",
		files: { "index.css": "/* x */" },
	});
	const gate = () => {
		let open!: () => void;
		const opened = new Promise<void>((resolve) => (open = resolve));
		return { opened, open };
	};
	const settle = async () => {
		for (let i = 0; i < 50; i++) await Promise.resolve();
	};

	beforeEach(() => {
		states = [
			{ identifier: "stdlib", version: "1.0.0", local: false, loaded: true },
			{ identifier: "lyrics-plus", version: "0.3.0", local: true, loaded: true },
			{ identifier: "adblock", version: "0.1.0", local: true, loaded: true },
		];
		locals = [local("lyrics-plus", "0.3.0"), local("adblock", "0.1.0")];
		spicetify.Daemon = {
			available: () => Promise.resolve(true),
			send: () => Promise.resolve("ok"),
			apply: () => Promise.resolve(),
		};
	});
	afterEach(() => {
		spicetify.Daemon = undefined;
	});

	it("commits a stdlib stage only after a running swap finishes", async () => {
		const swapping = gate();
		installLocalImpl = () => swapping.opened.then(() => true);
		const swap = installModule(inline("lyrics-plus", "0.4.0"), () => {});
		await settle();
		const stage = stageStdlibViaDaemon(
			{ id: "stdlib", version: "1.1.0", artifacts: ["https://example.com/stdlib.zip"], vault: "default" },
			() => {},
		);
		await settle();
		assert.equal(store.get(MARKER), undefined, "the swap passed its recheck against the running stdlib");
		swapping.open();
		assert.deepEqual(await swap, { requiresRestart: false, enabled: true });
		assert.equal(await stage, "staged");
		assert.equal(store.get(MARKER), "1.1.0");
	});

	it("unloads a hung swap that finishes after a stdlib stage commits", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const swapping = gate();
		installLocalImpl = () => swapping.opened.then(() => true);
		const outcome = installModule(inline("lyrics-plus", "0.4.0"), () => {});
		await settle();
		t.mock.timers.tick(15_001);
		assert.deepEqual(await outcome, { requiresRestart: true, enabled: false });
		store.set(MARKER, "1.1.0");
		swapping.open();
		await settle();
		assert.deepEqual(unloaded, ["lyrics-plus"]);
	});

	it("leaves a hung swap that finishes with no stdlib stage loaded", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const swapping = gate();
		installLocalImpl = () => swapping.opened.then(() => true);
		const outcome = installModule(inline("lyrics-plus", "0.4.0"), () => {});
		await settle();
		t.mock.timers.tick(15_001);
		await outcome;
		swapping.open();
		await settle();
		assert.deepEqual(unloaded, []);
	});

	it("holds a swap that queued behind a stdlib commit", async () => {
		const swapping = gate();
		installLocalImpl = () => swapping.opened.then(() => true);
		const first = installModule(inline("lyrics-plus", "0.4.0"), () => {});
		await settle();
		const stage = stageStdlibViaDaemon(
			{ id: "stdlib", version: "1.1.0", artifacts: ["https://example.com/stdlib.zip"], vault: "default" },
			() => {},
		);
		await settle();
		const second = installModule(inline("adblock", "0.2.0"), () => {});
		await settle();
		swapping.open();
		await first;
		await stage;
		await assert.rejects(second, /a stdlib update is staged/);
		assert.deepEqual(installed, ["lyrics-plus"]);
	});
});
