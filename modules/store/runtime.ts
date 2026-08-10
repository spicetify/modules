/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const M = () => (globalThis as never as Record<string, any>).Spicetify.Modules;
export const PLATFORM = () => (globalThis as never as Record<string, any>).Spicetify?.Platform;

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
