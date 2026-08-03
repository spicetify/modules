/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type Catalog, loadCatalog, type VaultModule } from "./catalog.ts";
import { localRecords } from "./install.ts";
import { disposed, toast } from "./runtime.ts";

// Installed modules the catalog has a different version for.
// User-authored (custom) modules are never vault-managed, even if a
// vault entry happens to share their id.
export function pendingUpdates(catalog: Catalog): VaultModule[] {
	const locals = localRecords().filter((r) => !(r.metadata.tags ?? []).includes("custom"));
	const versions = new Map(locals.map((r) => [r.metadata.identifier, r.sidecar?.installed_version]));
	return catalog.modules.filter((mod) => {
		const installed = versions.get(mod.id);
		return installed !== undefined && installed !== mod.version && !catalog.revoked[mod.id];
	});
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
