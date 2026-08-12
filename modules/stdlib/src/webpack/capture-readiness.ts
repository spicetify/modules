/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface CaptureReadinessOptions {
	timeoutMs: number;
	onTimeout?: () => void;
	scheduleTimeout?: typeof setTimeout;
	clearScheduledTimeout?: typeof clearTimeout;
}

export function createCaptureReadiness(options: CaptureReadinessOptions) {
	const settled = Promise.withResolvers<void>();
	let released = false;
	let analyzed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const scheduleTimeout = options.scheduleTimeout ?? setTimeout;
	const clearScheduledTimeout = options.clearScheduledTimeout ?? clearTimeout;
	const release = () => {
		if (released) return;
		released = true;
		if (timer !== undefined) clearScheduledTimeout(timer);
		settled.resolve(undefined);
	};

	return {
		wait(): Promise<void> {
			if (!released && timer === undefined) {
				timer = scheduleTimeout(() => {
					options.onTimeout?.();
					release();
				}, options.timeoutMs);
			}
			return settled.promise;
		},
		run(work: () => void, onFailure: (error: unknown) => void): void {
			if (analyzed) return;
			analyzed = true;
			try {
				work();
			} catch (error) {
				onFailure(error);
			} finally {
				release();
			}
		},
	};
}
