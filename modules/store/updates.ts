/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type Catalog, compareVersions, loadCatalog, type VaultModule } from "./catalog.ts";
import { installedRecords } from "./install.ts";
import { disposed, toast } from "./runtime.ts";

// Installed modules (localStorage or CLI-staged) the catalog has a different
// version for, dependencies before dependents: "Update all" installs
// sequentially, and a dependent re-enabling against a not-yet-updated
// dependency mid-batch would hit the loader's range check. User-authored
// (custom) modules are never vault-managed, even if a vault entry happens to
// share their id.
export function pendingUpdates(catalog: Catalog): VaultModule[] {
	const installed = installedRecords().filter((r) => !(r.metadata.tags ?? []).includes("custom"));
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
			return compareVersions(mod.version, version) > 0;
		})
		.sort((a, b) => Number(dependedUpon.has(b.id)) - Number(dependedUpon.has(a.id)));
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
