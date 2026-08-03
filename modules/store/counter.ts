/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { INSTALLS_API, type VaultModule } from "./catalog.ts";
import { disposed, onCountsChanged, PLATFORM, retryTimers } from "./runtime.ts";

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
// counter is down. The server verifies the token against Spotify and
// stores only a keyed hash of the account id, so repeat installs by the
// same account are not double counted.
export function reportInstall(mod: VaultModule, attempt = 0): void {
	if (disposed) return;
	try {
		const session = PLATFORM()?.Session;
		const token = session?.accessToken;
		if (!token || session?.isAnonymous) return;
		void fetch(`${INSTALLS_API()}/v1/installs`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({ module: mod.id, version: mod.version.split("+")[0] }),
		})
			.then(async (res) => {
				// Spotify throttles the server's identity check at times; one
				// deferred retry recovers most of those counts.
				if (res.status === 503 && attempt === 0) {
					const wait = Number(res.headers.get("retry-after") ?? 60);
					const timer = setTimeout(
						() => {
							retryTimers.delete(timer);
							if (!disposed) reportInstall(mod, 1);
						},
						Math.min(wait, 120) * 1000,
					);
					retryTimers.add(timer);
					return;
				}
				if (!res.ok) return;
				const data = (await res.json()) as { counted?: boolean };
				if (data.counted) {
					installCounts[mod.id] = (installCounts[mod.id] ?? 0) + 1;
					onCountsChanged?.();
				}
			})
			.catch(() => {});
	} catch {}
}
