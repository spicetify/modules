/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type Catalog, compareVersions, loadCatalog, type VaultModule } from "./catalog.ts";
import { type InstallOutcome, installedRecords, installModule, isCustomRecord } from "./install.ts";
import { disposed, dropStdlibDiskStaged, M, retryTimers, stdlibDiskStaged, toast } from "./runtime.ts";

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

// Once a boot runs a stdlib at least as new as the marker, the apply
// happened and the hold can lift.
export function clearSettledStdlibMarker(): void {
	const marker = stdlibDiskStaged();
	if (!marker) return;
	const state = runningStdlib();
	if (state && compareVersions(state.version, marker) >= 0) {
		dropStdlibDiskStaged();
	}
}

// A maintainer can withdraw the very release the marker is waiting on, by
// pinning the vault back to an older version or revoking stdlib outright.
// The marker would then hold every update for an apply that must not
// happen, so it has to notice and stand down.
export function stdlibMarkerWithdrawn(catalog: Catalog, marker: string): boolean {
	if (catalog.revoked["stdlib"] !== undefined) return true;
	const entry = catalog.modules.find((mod) => mod.id === "stdlib");
	return !!entry && compareVersions(entry.version, marker) < 0;
}

function runningStdlib(): { identifier: string; version: string } | undefined {
	return ((M().list?.() ?? []) as Array<{ identifier: string; version: string }>).find(
		(s) => s.identifier === "stdlib",
	);
}

// A stdlib update installed this session is only staged: the registry keeps
// running the old version until the next boot (record path) or the next
// apply (disk path), and once the record or marker is written,
// pendingUpdates may stop listing stdlib at all. While either staged copy
// is newer than the running one, hot-applying anything else carries the
// same hazard the batch gate exists for, so the gate has to keep holding
// even though the batch itself no longer contains stdlib.
export function stdlibRestartPending(): boolean {
	const state = runningStdlib();
	if (!state) return false;
	const record = (M().listLocal?.() ?? []).find(
		(r: { metadata: { identifier: string; version?: string }; sidecar?: { installed_version?: string } }) =>
			r.metadata.identifier === "stdlib",
	);
	const staged = record?.sidecar?.installed_version ?? record?.metadata?.version;
	if (staged && compareVersions(staged, state.version) > 0) return true;
	const disk = stdlibDiskStaged();
	return !!disk && compareVersions(disk, state.version) > 0;
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

// Set while updates are held back for a staged stdlib: the next boot that
// runs it installs them without another click.
export const RESUME_UPDATES_KEY = "spicetify:store:resumeUpdates";

export function resumePending(): boolean {
	return globalThis.localStorage?.getItem(RESUME_UPDATES_KEY) !== null;
}

type Install = (mod: VaultModule, status: (msg: string) => void) => Promise<InstallOutcome>;

/**
 * Installs a batch of updates through the stdlib gate. When stdlib is staged
 * but not yet running, the rest of the batch is held and remembered, and
 * the boot that brings the new stdlib up finishes it.
 */
export async function runUpdates(
	pending: VaultModule[],
	status: (msg: string) => void,
	install: Install = installModule,
): Promise<void> {
	const { install: first, deferred } = stdlibGate(pending, stdlibRestartPending());
	// "staged" when the new stdlib only arrives with the next boot,
	// "failed" when it did not land at all, null when it is live (or was
	// never part of the batch) and the deferred updates can proceed.
	let hold: "staged" | "failed" | null = deferred.length ? "staged" : null;
	for (const mod of first) {
		try {
			const outcome = await install(mod, status);
			if (mod.id === "stdlib" && outcome.enabled) hold = null;
			if (mod.id === "stdlib" && !outcome.enabled && !outcome.requiresRestart) hold = "failed";
		} catch (e) {
			if (mod.id === "stdlib") hold = "failed";
			toast(`update failed for ${mod.id}: ${(e as Error).message}`, "error");
			status("");
		}
	}
	for (const mod of hold === null ? deferred : []) {
		try {
			await install(mod, status);
		} catch (e) {
			toast(`update failed for ${mod.id}: ${(e as Error).message}`, "error");
			status("");
		}
	}
	if (hold === "staged") {
		globalThis.localStorage?.setItem(RESUME_UPDATES_KEY, "1");
		const bringUp = stdlibDiskStaged() ? "you apply it with the control above" : "Spotify restarts";
		toast(
			`${deferred.length} update${deferred.length === 1 ? "" : "s"} will install once the new stdlib runs, after ${bringUp}`,
		);
		return;
	}
	globalThis.localStorage?.removeItem(RESUME_UPDATES_KEY);
	if (hold === "failed") {
		toast(
			`${deferred.length} update${deferred.length === 1 ? "" : "s"} held back: they may need the new stdlib, and its update did not land`,
		);
	}
}

// Boot-time nudge: check the vault once and toast when installed modules
// have updates waiting. Purely informational; installing stays
// user-initiated in the store page. The last announced set is remembered
// so the same pending updates don't re-toast on every client start.
const ANNOUNCED_KEY = "spicetify:store:announcedUpdates";

// The store loads during the loader's boot, before Spicetify.Modules is
// published, so boot-time work waits for it. False on timeout or dispose.
function loaderPublished(): boolean {
	try {
		return !!M();
	} catch {
		return false;
	}
}

export async function loaderReady(timeoutMs = 60_000, intervalMs = 250): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (!disposed) {
		if (loaderPublished()) return true;
		if (Date.now() >= deadline) return false;
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				retryTimers.delete(timer);
				resolve();
			}, intervalMs);
			retryTimers.add(timer);
		});
	}
	return false;
}

export async function announceUpdates(install: Install = installModule): Promise<void> {
	try {
		if (!(await loaderReady())) return;
		clearSettledStdlibMarker();
		const catalog = await loadCatalog();
		if (!catalog.ok || disposed) return;
		const marker = stdlibDiskStaged();
		if (marker && stdlibMarkerWithdrawn(catalog, marker)) {
			dropStdlibDiskStaged();
			globalThis.localStorage?.removeItem(RESUME_UPDATES_KEY);
			toast(`the staged stdlib ${marker} was withdrawn by the vault and will not be applied automatically`);
		}
		const pending = pendingUpdates(catalog);
		if (resumePending() && !stdlibRestartPending()) {
			if (!pending.length) {
				globalThis.localStorage?.removeItem(RESUME_UPDATES_KEY);
				return;
			}
			toast(`finishing ${pending.length} module update${pending.length === 1 ? "" : "s"} held back for stdlib…`);
			await runUpdates(pending, () => {}, install);
			return;
		}
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
