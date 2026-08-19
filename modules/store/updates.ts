/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type Catalog, compareVersions, loadCatalog, type VaultModule } from "./catalog.ts";
import { installedRecords, isCustomRecord } from "./install.ts";
import { disposed, M, toast } from "./runtime.ts";

// Installed modules (localStorage or CLI-staged) the catalog has a different
// version for, dependencies before dependents: "Update all" installs
// sequentially, and a dependent re-enabling against a not-yet-updated
// dependency mid-batch would hit the loader's range check. User-authored
// (custom) modules are never vault-managed, even if a vault entry happens to
// share their id.
export function pendingUpdates(catalog: Catalog): VaultModule[] {
	const installed = installedRecords().filter((r) => !isCustomRecord(r.metadata));
	const byId = new Map(installed.map((r) => [r.metadata.identifier, r]));
	const dependedUpon = new Set(installed.flatMap((r) => Object.keys(r.metadata.dependencies ?? {})));
	return catalog.modules
		.filter((mod) => {
			const record = byId.get(mod.id);
			const version = record?.sidecar?.installed_version;
			if (version === undefined || version === mod.version || catalog.revoked[mod.id]) return false;
			// Only a strictly newer vault version is an update, whichever way
			// the module is installed. An installed copy can legitimately be
			// ahead of the vault (a dev push, a release that was pulled), and
			// offering the older vault version as an "update" either overwrites
			// the running copy with an older one or, against a CLI-staged
			// install, writes a record the loader's localWins rule will refuse
			// forever while the banner never clears.
			if (compareVersions(mod.version, version) > 0) return true;
			// The exception: a pinned version is a maintainer rolling a bad
			// release back, and `validate-submission` forbids deleting the bad
			// version, so the pin is the only signal users get. Without this,
			// everyone who installed the broken build keeps running it.
			return !!mod.pinned && compareVersions(mod.version, version) !== 0;
		})
		.sort((a, b) => Number(dependedUpon.has(b.id)) - Number(dependedUpon.has(a.id)));
}

// A stdlib update installed this session is only staged: the registry keeps
// running the old version until the next boot, and once the record is
// written pendingUpdates stops listing stdlib at all. While the staged
// record is newer than the running copy, hot-applying anything else carries
// the same hazard the batch gate exists for, so the gate has to keep
// holding even though the batch itself no longer contains stdlib.
export function stdlibRestartPending(): boolean {
	const record = (M().listLocal?.() ?? []).find(
		(r: { metadata: { identifier: string; version?: string }; sidecar?: { installed_version?: string } }) =>
			r.metadata.identifier === "stdlib",
	);
	const staged = record?.sidecar?.installed_version ?? record?.metadata?.version;
	if (!staged) return false;
	const state = ((M().list?.() ?? []) as Array<{ identifier: string; version: string }>).find(
		(s) => s.identifier === "stdlib",
	);
	return !!state && compareVersions(staged, state.version) > 0;
}

// stdlib is a tree module: installing its update stages the new code, which
// only takes over on the next boot, while every other update hot-swaps into
// the running client immediately. A batch that mixes the two hot-swaps
// dependents built against the newer stdlib onto the old one still running,
// which is how "Update all" once filled the console with import errors. So a
// batch containing a stdlib update (or run while a staged stdlib waits for
// its restart) installs at most stdlib itself, and the rest wait for the
// restart that actually brings it up.
export function stdlibGate(
	pending: VaultModule[],
	restartPending = false,
): { install: VaultModule[]; deferred: VaultModule[] } {
	const stdlib = pending.find((mod) => mod.id === "stdlib");
	if (!stdlib && !restartPending) return { install: pending, deferred: [] };
	return { install: stdlib ? [stdlib] : [], deferred: pending.filter((mod) => mod.id !== "stdlib") };
}

// Boot-time nudge: check the vault once and toast when installed modules
// have updates waiting. Purely informational; installing stays
// user-initiated in the store page. The last announced set is remembered
// so the same pending updates don't re-toast on every client start.
const ANNOUNCED_KEY = "spicetify:store:announcedUpdates";

export async function announceUpdates(): Promise<void> {
	try {
		const catalog = await loadCatalog();
		if (!catalog.ok || disposed) return;
		const pending = pendingUpdates(catalog);
		if (!pending.length) {
			globalThis.localStorage?.removeItem(ANNOUNCED_KEY);
			return;
		}
		const key = pending
			.map((mod) => `${mod.id}@${mod.version}`)
			.sort()
			.join(",");
		if (globalThis.localStorage?.getItem(ANNOUNCED_KEY) === key) return;
		globalThis.localStorage?.setItem(ANNOUNCED_KEY, key);
		toast(`${pending.length} module update${pending.length === 1 ? "" : "s"} available in the Module Store`);
	} catch {
		/* a failed update check must never disturb boot */
	}
}
