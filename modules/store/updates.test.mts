/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// pendingUpdates reads the loader through runtime.ts's call-time M(), so a
// plain global stub is enough - no DOM harness needed.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { Catalog, VaultModule } from "./catalog.ts";
import type { InstallOutcome } from "./install.ts";
import { markStdlibDiskStaged, stdlibDiskStaged } from "./runtime.ts";
import {
	announceUpdates,
	clearSettledStdlibMarker,
	loaderReady,
	RESUME_UPDATES_KEY,
	resumePending,
	runUpdates,
	pendingUpdates,
	stdlibGate,
	stdlibMarkerWithdrawn,
	stdlibRestartPending,
} from "./updates.ts";

type LocalRecord = {
	metadata: { identifier: string; kind?: string; custom?: boolean; dependencies?: Record<string, string> };
	sidecar?: { installed_version?: string };
};

let locals: LocalRecord[] = [];
let stagedStates: Array<{ identifier: string; version: string; local: boolean }> = [];
let manifestModules: Array<Record<string, unknown>> = [];
const storage = new Map<string, string>();
(globalThis as never as Record<string, unknown>).localStorage = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => void storage.set(key, String(value)),
	removeItem: (key: string) => void storage.delete(key),
};
const toasts: string[] = [];
const spicetify: Record<string, unknown> = {
	showNotification: (message: string) => void toasts.push(message),
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
const modules = spicetify.Modules;
(globalThis as never as Record<string, unknown>).Spicetify = spicetify;

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
	storage.clear();
	toasts.length = 0;
	spicetify.Modules = modules;
});

const serveVault = (modules: Record<string, string>) =>
	storage.set(
		"spicetify:defaultVaultUrl",
		`data:application/json,${encodeURIComponent(
			JSON.stringify({
				modules: Object.fromEntries(
					Object.entries(modules).map(([id, version]) => [id, { v: { [version]: { artifacts: ["x"] } } }]),
				),
			}),
		)}`,
	);

describe("announceUpdates", () => {
	it("waits for the loader to publish Spicetify.Modules before checking", async () => {
		locals = [{ metadata: { identifier: "trashbin" }, sidecar: { installed_version: "0.2.5" } }];
		serveVault({ trashbin: "0.2.6" });
		spicetify.Modules = undefined;
		const announcing = announceUpdates();
		setTimeout(() => (spicetify.Modules = modules), 50);
		await announcing;
		assert.deepEqual(toasts, ["1 module update available in the Module Store"]);
		assert.equal(storage.get("spicetify:store:announcedUpdates"), "trashbin@0.2.6");
	});

	it("gives up quietly when the loader never comes up", async () => {
		spicetify.Modules = undefined;
		assert.equal(await loaderReady(40, 10), false);
		spicetify.Modules = modules;
		assert.equal(await loaderReady(40, 10), true);
	});
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
			{
				metadata: { identifier: "mine", kind: "snippet", custom: true },
				sidecar: { installed_version: "0.1.0" },
			},
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

	it("never offers a local record an older vault version either", () => {
		// A dev push, or a release that was pulled: the installed copy is
		// ahead of the vault, and calling the older version an update would
		// overwrite the running one with it.
		locals = [{ metadata: { identifier: "ahead-locally" }, sidecar: { installed_version: "1.2.0" } }];
		assert.deepEqual(pendingUpdates(catalog([entry("ahead-locally", "1.1.0")])), []);
	});

	it("follows the registry when a local record is shadowed by the staged copy", () => {
		// The loader refused the record (localWins), so the staged 1.0.0 is
		// what runs; the vault's newer 1.1.0 must be offered — a fresh
		// install remaps against the current classmap and does win.
		locals = [{ metadata: { identifier: "both" }, sidecar: { installed_version: "1.1.0" } }];
		stagedStates = [{ identifier: "both", version: "1.0.0", local: false }];
		manifestModules = [{ identifier: "both", version: "1.0.0" }];
		const out = pendingUpdates(catalog([entry("both", "1.1.0")]));
		assert.deepEqual(
			out.map((m) => m.id),
			["both"],
		);
	});

	it("prefers a winning local override over its staged copy", () => {
		locals = [{ metadata: { identifier: "both" }, sidecar: { installed_version: "1.1.0" } }];
		stagedStates = [{ identifier: "both", version: "1.0.0", local: true }];
		manifestModules = [{ identifier: "both", version: "1.1.0" }];
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

describe("stdlibGate", () => {
	it("passes a batch with no stdlib update through untouched", () => {
		const pending = [entry("a", "1.1.0"), entry("b", "2.1.0")];
		assert.deepEqual(stdlibGate(pending), { install: pending, deferred: [] });
	});

	it("installs stdlib alone and defers everything else", () => {
		// stdlib only takes over on the next boot; hot-swapping the rest of
		// the batch onto the old running stdlib is what broke "Update all".
		const pending = [entry("a", "1.1.0"), entry("stdlib", "1.10.0"), entry("b", "2.1.0")];
		const { install, deferred } = stdlibGate(pending);
		assert.deepEqual(
			install.map((m) => m.id),
			["stdlib"],
		);
		assert.deepEqual(
			deferred.map((m) => m.id),
			["a", "b"],
		);
	});

	it("lets a batch that is only the stdlib update install it", () => {
		const pending = [entry("stdlib", "1.10.0")];
		const { install, deferred } = stdlibGate(pending);
		assert.deepEqual(
			install.map((m) => m.id),
			["stdlib"],
		);
		assert.deepEqual(deferred, []);
	});

	it("keeps holding the batch while a staged stdlib waits for its restart", () => {
		// Once the stdlib record is written, pendingUpdates stops listing
		// stdlib, so a second "Update all" click would otherwise hot-apply
		// the deferred modules against the old running stdlib.
		const pending = [entry("a", "1.1.0"), entry("b", "2.1.0")];
		assert.deepEqual(stdlibGate(pending, true), { install: [], deferred: pending });
	});
});

describe("the second Update-all click after staging stdlib", () => {
	it("no longer lists stdlib as pending, so only restartPending keeps the batch held", () => {
		// A store-driven stdlib update writes a record with the new version
		// while the registry keeps running the old one. pendingUpdates then
		// stops offering stdlib, and without the restartPending signal the
		// gate would wave the deferred modules through against old stdlib.
		locals = [
			{ metadata: { identifier: "stdlib" }, sidecar: { installed_version: "1.11.0" } },
			{ metadata: { identifier: "bookmark" }, sidecar: { installed_version: "0.4.0" } },
		];
		stagedStates = [{ identifier: "stdlib", version: "1.10.0", local: true }];
		const pending = pendingUpdates(catalog([entry("stdlib", "1.11.0"), entry("bookmark", "0.4.1")]));
		assert.deepEqual(
			pending.map((m) => m.id),
			["bookmark"],
		);
		assert.equal(stdlibRestartPending(), true);
		assert.deepEqual(stdlibGate(pending, stdlibRestartPending()), { install: [], deferred: pending });
	});
});

describe("stdlibRestartPending", () => {
	it("is false with no stdlib record at all", () => {
		stagedStates = [{ identifier: "stdlib", version: "1.9.0", local: false }];
		assert.equal(stdlibRestartPending(), false);
	});

	it("is true while the written record is newer than the running copy", () => {
		locals = [{ metadata: { identifier: "stdlib" }, sidecar: { installed_version: "1.10.0" } }];
		stagedStates = [{ identifier: "stdlib", version: "1.9.0", local: false }];
		assert.equal(stdlibRestartPending(), true);
	});

	it("is false once the restart has brought the new version up", () => {
		locals = [{ metadata: { identifier: "stdlib" }, sidecar: { installed_version: "1.10.0" } }];
		stagedStates = [{ identifier: "stdlib", version: "1.10.0", local: true }];
		assert.equal(stdlibRestartPending(), false);
	});

	it("also holds while a daemon-staged stdlib waits for its apply", () => {
		// The disk path writes no record at all; only the marker knows the
		// new version is sitting in the store tree.
		stagedStates = [{ identifier: "stdlib", version: "1.10.0", local: false }];
		markStdlibDiskStaged("1.10.1");
		assert.equal(stdlibRestartPending(), true);
	});
});

describe("the disk-staged marker", () => {
	it("lifts once a boot runs a stdlib at least as new", () => {
		markStdlibDiskStaged("1.10.1");
		stagedStates = [{ identifier: "stdlib", version: "1.10.1", local: false }];
		clearSettledStdlibMarker();
		assert.equal(stdlibDiskStaged(), null);
	});

	it("keeps holding while the running stdlib is still older", () => {
		markStdlibDiskStaged("1.10.1");
		stagedStates = [{ identifier: "stdlib", version: "1.10.0", local: false }];
		clearSettledStdlibMarker();
		assert.equal(stdlibDiskStaged(), "1.10.1");
	});

	it("stands down when the vault withdraws the release it waits on", () => {
		// A pin back to an older version or a revocation means the staged
		// copy must not be applied; holding every update for it would wedge
		// the client with no legitimate way out.
		assert.equal(stdlibMarkerWithdrawn(catalog([entry("stdlib", "1.10.0")]), "1.10.1"), true);
		assert.equal(stdlibMarkerWithdrawn(catalog([entry("stdlib", "1.10.1")]), "1.10.1"), false);
		assert.equal(stdlibMarkerWithdrawn(catalog([entry("stdlib", "1.10.2")]), "1.10.1"), false);
		assert.equal(stdlibMarkerWithdrawn(catalog([], { stdlib: "compromised" }), "1.10.1"), true);
	});
});

describe("a maintainer rollback", () => {
	it("is offered when the vault pins an older version, and is not when it merely lags", () => {
		locals = [{ metadata: { identifier: "lyrics-plus" }, sidecar: { installed_version: "2.1.0" } }];

		const pinned = { ...entry("lyrics-plus", "2.0.0"), pinned: true };
		assert.deepEqual(
			pendingUpdates(catalog([pinned])).map((m) => m.version),
			["2.0.0"],
			"a pin is the only signal users get that a release was withdrawn",
		);

		assert.deepEqual(
			pendingUpdates(catalog([entry("lyrics-plus", "2.0.0")])),
			[],
			"an unpinned older vault entry stays a no-op, as before",
		);
	});
});

describe("runUpdates", () => {
	const installer = (outcomes: Record<string, InstallOutcome | Error> = {}) => {
		const installed: string[] = [];
		const install = async (mod: VaultModule) => {
			installed.push(mod.id);
			const outcome = outcomes[mod.id] ?? { requiresRestart: false, enabled: true };
			if (outcome instanceof Error) throw outcome;
			return outcome;
		};
		return { installed, install };
	};
	const staged = { requiresRestart: true, enabled: false };

	it("installs a batch without stdlib in one go and leaves nothing to resume", async () => {
		const { installed, install } = installer();
		await runUpdates([entry("a", "1.1.0"), entry("b", "2.1.0")], () => {}, install);
		assert.deepEqual(installed, ["a", "b"]);
		assert.equal(resumePending(), false);
	});

	it("stages stdlib alone and remembers the rest for the restart", async () => {
		const { installed, install } = installer({ stdlib: staged });
		await runUpdates([entry("stdlib", "1.14.0"), entry("a", "1.1.0")], () => {}, install);
		assert.deepEqual(installed, ["stdlib"]);
		assert.equal(resumePending(), true);
		assert.deepEqual(toasts, ["1 update will install once the new stdlib runs, after Spotify restarts"]);
	});

	it("points at the apply control when the daemon staged stdlib on disk", async () => {
		const { install } = installer({ stdlib: staged });
		markStdlibDiskStaged("1.14.0");
		await runUpdates([entry("stdlib", "1.14.0"), entry("a", "1.1.0")], () => {}, install);
		assert.match(toasts[0] ?? "", /after you apply it with the control above$/);
	});

	it("carries on with the batch when the new stdlib came up live", async () => {
		const { installed, install } = installer();
		await runUpdates([entry("stdlib", "1.14.0"), entry("a", "1.1.0")], () => {}, install);
		assert.deepEqual(installed, ["stdlib", "a"]);
		assert.equal(resumePending(), false);
	});

	it("holds the rest without resuming when the stdlib update failed", async () => {
		const { installed, install } = installer({ stdlib: new Error("checksum mismatch") });
		storage.set(RESUME_UPDATES_KEY, "1");
		await runUpdates([entry("stdlib", "1.14.0"), entry("a", "1.1.0")], () => {}, install);
		assert.deepEqual(installed, ["stdlib"]);
		assert.equal(resumePending(), false);
		assert.deepEqual(toasts, ["1 update held back: they may need the new stdlib, and its update did not land"]);
	});

	it("keeps going past one module's failure", async () => {
		const { installed, install } = installer({ a: new Error("offline") });
		await runUpdates([entry("a", "1.1.0"), entry("b", "2.1.0")], () => {}, install);
		assert.deepEqual(installed, ["a", "b"]);
	});
});

describe("finishing held-back updates at boot", () => {
	const install =
		(installed: string[], outcome = { requiresRestart: false, enabled: true }) =>
		async (mod: VaultModule) => {
			installed.push(mod.id);
			return outcome;
		};

	it("installs them once the new stdlib is running", async () => {
		storage.set(RESUME_UPDATES_KEY, "1");
		stagedStates = [{ identifier: "stdlib", version: "1.14.0", local: false }];
		manifestModules = [{ identifier: "stdlib", version: "1.14.0" }];
		locals = [{ metadata: { identifier: "a" }, sidecar: { installed_version: "1.0.0" } }];
		serveVault({ stdlib: "1.14.0", a: "1.1.0" });
		const installed: string[] = [];
		await announceUpdates(install(installed));
		assert.deepEqual(installed, ["a"]);
		assert.equal(resumePending(), false);
		assert.deepEqual(toasts, ["finishing 1 module update held back for stdlib…"]);
	});

	it("sees a record carrying build metadata as running once its version runs", async () => {
		storage.set(RESUME_UPDATES_KEY, "1");
		stagedStates = [{ identifier: "stdlib", version: "1.14.0", local: true }];
		locals = [
			{ metadata: { identifier: "stdlib" }, sidecar: { installed_version: "1.14.0+cm-1020094" } },
			{ metadata: { identifier: "a" }, sidecar: { installed_version: "1.0.0" } },
		];
		serveVault({ stdlib: "1.14.0+cm-1020094", a: "1.1.0" });
		const installed: string[] = [];
		await announceUpdates(install(installed));
		assert.deepEqual(installed, ["a"]);
		assert.equal(resumePending(), false);
	});

	it("waits for another boot while the staged stdlib still isn't running", async () => {
		storage.set(RESUME_UPDATES_KEY, "1");
		markStdlibDiskStaged("1.14.0");
		stagedStates = [{ identifier: "stdlib", version: "1.13.1", local: false }];
		locals = [{ metadata: { identifier: "a" }, sidecar: { installed_version: "1.0.0" } }];
		serveVault({ stdlib: "1.14.0", a: "1.1.0" });
		const installed: string[] = [];
		await announceUpdates(install(installed));
		assert.deepEqual(installed, []);
		assert.equal(resumePending(), true);
		assert.deepEqual(toasts, ["2 module updates available in the Module Store"]);
	});

	it("stages a stdlib published since and keeps the rest waiting", async () => {
		storage.set(RESUME_UPDATES_KEY, "1");
		stagedStates = [{ identifier: "stdlib", version: "1.14.0", local: false }];
		manifestModules = [{ identifier: "stdlib", version: "1.14.0" }];
		locals = [{ metadata: { identifier: "a" }, sidecar: { installed_version: "1.0.0" } }];
		serveVault({ stdlib: "1.15.0", a: "1.1.0" });
		const installed: string[] = [];
		await announceUpdates(install(installed, { requiresRestart: true, enabled: false }));
		assert.deepEqual(installed, ["stdlib"]);
		assert.equal(resumePending(), true);
	});

	it("forgets the hold when nothing is left to update", async () => {
		storage.set(RESUME_UPDATES_KEY, "1");
		stagedStates = [{ identifier: "stdlib", version: "1.14.0", local: false }];
		serveVault({ stdlib: "1.14.0" });
		await announceUpdates(install([]));
		assert.equal(resumePending(), false);
		assert.deepEqual(toasts, []);
	});

	it("forgets the hold when the vault withdraws the staged stdlib", async () => {
		storage.set(RESUME_UPDATES_KEY, "1");
		markStdlibDiskStaged("1.14.0");
		stagedStates = [{ identifier: "stdlib", version: "1.13.1", local: false }];
		serveVault({ stdlib: "1.13.1" });
		await announceUpdates(install([]));
		assert.equal(resumePending(), false);
		assert.equal(stdlibDiskStaged(), null);
	});

	it("keeps the hold when the vault can't be reached", async () => {
		storage.set(RESUME_UPDATES_KEY, "1");
		storage.set("spicetify:defaultVaultUrl", "data:application/json,not-json");
		const installed: string[] = [];
		await announceUpdates(install(installed));
		assert.deepEqual(installed, []);
		assert.equal(resumePending(), true);
	});
});
