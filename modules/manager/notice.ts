/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

type Timer = ReturnType<typeof setInterval>;
type Schedule = (callback: () => void, delay: number) => Timer;
type Cancel = (timer: Timer) => void;

// Snackbar can register after Manager mounts. Try immediately, then briefly
// retry without needing an unrelated React state change to rerun the effect.
export function retryNotice(
	notify: () => boolean,
	schedule: Schedule = setInterval,
	cancel: Cancel = clearInterval,
	maxAttempts = 20,
): () => void {
	if (notify()) return () => {};
	let attempts = 0;
	const timer = schedule(() => {
		attempts += 1;
		if (notify() || attempts >= maxAttempts) cancel(timer);
	}, 500);
	return () => cancel(timer);
}
