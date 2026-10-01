/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface RegistryQuietOptions {
	/** Number of modules currently registered. */
	count: () => number;
	/** Chunk script loads that have started but not finished. */
	pending: () => number;
	onQuiet: () => void;
	quietMs?: number;
	/** How long an in-flight chunk can hold back an otherwise unchanged registry. */
	pendingMs?: number;
	tickMs?: number;
	capMs?: number;
	now?: () => number;
}

// watchRegistryQuiet calls onQuiet once the module registry has not changed,
// and no chunk load has been in flight, for quietMs. A chunk that never
// finishes holds it back for at most pendingMs past the last registry change,
// and capMs bounds the whole wait so a pathological boot still resolves.
export function watchRegistryQuiet(options: RegistryQuietOptions): void {
	const { quietMs = 300, pendingMs = 2000, tickMs = 25, capMs = 10_000, now = Date.now } = options;
	const started = now();
	let last = -1;
	let changedAt = started;
	let quietSince = started;
	const timer = setInterval(() => {
		const count = options.count();
		const at = now();
		if (count !== last) {
			last = count;
			changedAt = at;
			quietSince = at;
		} else if (options.pending() > 0) {
			quietSince = at;
		}
		if (at - quietSince >= quietMs || at - changedAt >= pendingMs || at - started >= capMs) {
			clearInterval(timer);
			options.onQuiet();
		}
	}, tickMs);
}
