/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const QUIET_MS = 300;
const TICK_MS = 25;
const CAP_MS = 10_000;

// watchRegistryQuiet calls onQuiet once the module registry has not changed,
// and no chunk load has been in flight, for 300ms. A 10s cap bounds the wait
// so a chunk that never finishes, or a registry that never settles, still
// resolves.
export function watchRegistryQuiet(count: () => number, pending: () => number, onQuiet: () => void): void {
	const started = Date.now();
	let last = -1;
	let quietSince = started;
	const timer = setInterval(() => {
		const current = count();
		const at = Date.now();
		if (current !== last || pending() > 0) {
			last = current;
			quietSince = at;
		}
		if (at - quietSince >= QUIET_MS || at - started >= CAP_MS) {
			clearInterval(timer);
			onQuiet();
		}
	}, TICK_MS);
}
