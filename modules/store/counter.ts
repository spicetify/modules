/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { INSTALLS_API, type VaultModule } from "./catalog.ts";
import { disposed, onCountsChanged, PLATFORM } from "./runtime.ts";

// ---------- install counting (ranking signal) ----------

export const installCounts: Record<string, number> = {};

export async function fetchInstallCounts(ids: string[]): Promise<void> {
	const base = INSTALLS_API();
	for (let i = 0; i < ids.length; i += 100) {
		const chunk = ids.slice(i, i + 100);
		try {
			const res = await fetch(`${base}/v1/installs?modules=${encodeURIComponent(chunk.join(","))}`);
			if (!res.ok) return;
			const data = (await res.json()) as { counts?: Record<string, number> };
			Object.assign(installCounts, data.counts ?? {});
		} catch {
			return;
		}
	}
}

// Fire-and-forget: an install must never fail or slow down because the
// counter is down. The account id is read client-side (no token authenticates
// against Spotify's Web API in v3) and the server stores only a keyed hash, so
// repeat installs by the same account are not double counted.
export function reportInstall(mod: VaultModule): void {
	if (disposed) return;
	void (async () => {
		try {
			const session = PLATFORM()?.Session;
			if (session?.isAnonymous) return;
			const account = (await PLATFORM()?.UserAPI?.getUser?.())?.username;
			if (!account) return;
			const res = await fetch(`${INSTALLS_API()}/v1/installs`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ module: mod.id, version: mod.version.split("+")[0], account }),
			});
			if (!res.ok) return;
			const data = (await res.json()) as { counted?: boolean };
			if (data.counted) {
				installCounts[mod.id] = (installCounts[mod.id] ?? 0) + 1;
				onCountsChanged?.();
			}
		} catch {}
	})();
}
