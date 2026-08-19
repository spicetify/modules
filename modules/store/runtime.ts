/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const M = () => (globalThis as never as Record<string, any>).Spicetify.Modules;
export const PLATFORM = () => (globalThis as never as Record<string, any>).Spicetify?.Platform;
export const CORS_PROXY = () =>
	(globalThis as never as { Spicetify?: { CORSProxy?: { fetch?: typeof fetch } } }).Spicetify?.CORSProxy;

export type StoreDaemonApi = {
	available: () => Promise<boolean>;
	uninstallStaged?: (id: string, version: string) => Promise<unknown>;
	send?: (uri: string, opts?: { expectReply?: boolean; timeoutMs?: number }) => Promise<unknown>;
	apply?: () => Promise<unknown>;
};

export const DAEMON = (): StoreDaemonApi | null =>
	(globalThis as never as { Spicetify?: { Daemon?: StoreDaemonApi } }).Spicetify?.Daemon ?? null;

// Disk staging is only offered when the wrapper can both stage (send) and
// finish (apply); staging through a wrapper that cannot apply would latch a
// hold no UI could ever clear.
export type StagingDaemon = StoreDaemonApi & {
	send: NonNullable<StoreDaemonApi["send"]>;
	apply: NonNullable<StoreDaemonApi["apply"]>;
};

export const STAGING_DAEMON = (): StagingDaemon | null => {
	const api = DAEMON();
	return api?.send && api.apply ? (api as StagingDaemon) : null;
};

// A stdlib update the daemon staged on disk only reaches the client when an
// apply rebuilds the served tree, so the store remembers what it staged and
// holds updates until a boot runs it. Plain-semver values only: the vault
// key can carry +cm build metadata while the running version reported after
// an apply is the module's own metadata.json version.
export const STDLIB_DISK_STAGED_KEY = "spicetify:store:stdlibDiskStaged";

export function stdlibDiskStaged(): string | null {
	return globalThis.localStorage?.getItem(STDLIB_DISK_STAGED_KEY) ?? null;
}

export function markStdlibDiskStaged(version: string): void {
	globalThis.localStorage?.setItem(STDLIB_DISK_STAGED_KEY, version);
}

export function dropStdlibDiskStaged(): void {
	globalThis.localStorage?.removeItem(STDLIB_DISK_STAGED_KEY);
}

// Native Spotify toast (Encore Snackbar) for every terminal outcome, with a
// showNotification fallback for older clients. The store's inline status line
// only carries transient page state (catalog loading, install progress).
export function toast(message: string, variant: "success" | "error" | "default" = "default"): void {
	const S = (globalThis as never as Record<string, any>).Spicetify;
	try {
		if (S?.Snackbar?.enqueueSnackbar) {
			S.Snackbar.enqueueSnackbar(message, { variant });
			return;
		}
	} catch {}
	S?.showNotification?.(message, variant === "error");
}

// ---------- shared dom helpers ----------

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
}

// The page subscribes so a freshly counted install refreshes its badge.
export let onCountsChanged: (() => void) | null = null;
// Module lifecycle: dispose() must cancel retry timers and close
// overlays; nothing may outlive the module.
export let disposed = false;
export const retryTimers = new Set<ReturnType<typeof setTimeout>>();
export const openDialogClosers = new Set<() => void>();

// ESM importers cannot assign imported bindings, so cross-file writes to
// the two mutable flags above go through these mutators; readers import
// the live bindings directly.
export function setOnCountsChanged(fn: (() => void) | null): void {
	onCountsChanged = fn;
}

export function markDisposed(): void {
	disposed = true;
}
