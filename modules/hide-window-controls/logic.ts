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

export function createNativeWindowControls(
	acquire: (onDisconnect: (error: Error) => void) => Promise<{ release(): Promise<void> }>,
	setHidden: (hidden: boolean) => Promise<void>,
	onError: (error: unknown) => void,
) {
	let lease: { release(): Promise<void> } | undefined;
	let generation = 0;
	const restore = async () => {
		const previous = lease;
		lease = undefined;
		try {
			await setHidden(false);
		} finally {
			await previous?.release();
		}
	};
	return async (hidden: boolean) => {
		if (!hidden) {
			// Show the buttons before restoring their native mouse targets.
			await restore();
			return;
		}
		try {
			const current = generation;
			if (!lease) {
				const acquired = await acquire((error) => {
					generation++;
					lease = undefined;
					void setHidden(false).catch(onError);
					onError(error);
				});
				if (current !== generation) {
					await acquired.release();
					throw new Error("Native window controls disconnected while enabling");
				}
				lease = acquired;
			}
			await setHidden(true);
			if (current !== generation) await setHidden(false);
		} catch (error) {
			await restore().catch(onError);
			throw error;
		}
	};
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

export interface SharedReconcilerState {
	generation: number;
	desired: boolean;
	transition: Promise<void>;
}

export function createDebouncedReassertion(
	reassert: () => Promise<void>,
	schedule: (callback: () => void) => number,
	cancel: (id: number) => void,
	onError: (error: unknown) => void,
) {
	let active = true;
	let pending: number | undefined;

	return {
		trigger() {
			if (!active) return;
			if (pending !== undefined) cancel(pending);
			pending = schedule(() => {
				pending = undefined;
				if (active) void reassert().catch(onError);
			});
		},
		stop() {
			active = false;
			if (pending !== undefined) cancel(pending);
			pending = undefined;
		},
	};
}

export function createSharedStateReconciler(apply: (hidden: boolean) => Promise<void>, shared: SharedReconcilerState) {
	const generation = ++shared.generation;
	let active = true;
	const enqueue = () => {
		shared.transition = shared.transition.catch(() => undefined).then(() => apply(shared.desired));
		return shared.transition;
	};

	return {
		request(hidden: boolean) {
			if (!active || shared.generation !== generation) return shared.transition;
			shared.desired = hidden;
			return enqueue();
		},
		stop(finalState: boolean) {
			if (!active || shared.generation !== generation) return shared.transition;
			active = false;
			shared.desired = finalState;
			return enqueue();
		},
	};
}
