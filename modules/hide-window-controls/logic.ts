/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Pure, client-free module logic. Keep functions here dependency-free (no
 * /modules/* or client imports) so they are unit-testable; mod.tsx passes the
 * client capabilities into them. Starter tests import this file,
 * never mod.tsx.
 */

export const STORAGE_KEY = "spicetify:hide-window-controls";
export const HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE = "data-spicetify-hide-window-controls-required";

export function shouldHide(stored: string | null): boolean {
	return stored !== "0";
}

export function resolveHiddenState(stored: string | null, required: boolean): boolean {
	return required || shouldHide(stored);
}

export function createStateReconciler(apply: (hidden: boolean) => Promise<void>) {
	let active = true;
	let desired = false;
	let transition = Promise.resolve();

	const enqueue = () => {
		transition = transition.catch(() => undefined).then(() => apply(desired));
		return transition;
	};

	return {
		request(hidden: boolean) {
			if (!active) return transition;
			desired = hidden;
			return enqueue();
		},
		stop(finalState: boolean) {
			active = false;
			desired = finalState;
			return enqueue();
		},
	};
}
