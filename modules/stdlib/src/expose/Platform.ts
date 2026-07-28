/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The original exposed Platform via a runtime source transform of the client
// core bundle, which never executes on snapshot builds. Resolve lazily: the
// mixin phase imports this module before the client (and Spicetify._platform)
// exists, so capture must happen on first use, not at import time.
let cached: unknown;

function resolvePlatform(): any {
	if (cached === undefined) {
		cached = globalThis.Spicetify?._platform ?? null;
	}
	return cached ?? undefined;
}

export const Platform: any = new Proxy({}, {
	get: (_, key) => {
		const p = resolvePlatform();
		if (!p) return undefined;
		if (key in p) return p[key];
		if (typeof key === "string" && key.startsWith("get") && typeof p.getRegistry === "function") {
			const description = key.slice(3);
			for (const s of p.getRegistry()._map.keys()) {
				if (s.description === description) return () => p.getRegistry().resolve(s);
			}
		}
		return undefined;
	},
	has: (_, key) => {
		const p = resolvePlatform();
		if (!p) return false;
		if (key in p) return true;
		if (typeof key === "string" && key.startsWith("get") && typeof p.getRegistry === "function") {
			const description = key.slice(3);
			for (const s of p.getRegistry()._map.keys()) {
				if (s.description === description) return true;
			}
		}
		return false;
	},
});
