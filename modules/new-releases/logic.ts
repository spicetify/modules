/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The pure core of new-releases: art-url mapping, release-type labeling, the
// bounded-concurrency pool, feed dedupe/sort, the visible-feed filter, cache
// shape validation and day grouping, hoisted so they run under node --test.
// mod.tsx owns LibraryAPI/GraphQL fetching, storage I/O and the React page.

export const DAY_MS = 86400000;

export interface Release {
	uri: string;
	title: string;
	artist: { name: string; uri: string };
	imageUrl: string;
	time: number;
	type: string;
	trackCount: number;
}

export function artUrl(raw?: string): string {
	return raw?.startsWith("spotify:image:")
		? `https://i.scdn.co/image/${raw.slice("spotify:image:".length)}`
		: (raw ?? "");
}

export function largestCover(sources?: Array<{ url: string; width?: number }>): string {
	if (!sources?.length) return "";
	const best = sources.reduce((prev, curr) => ((prev.width ?? 0) > (curr.width ?? 0) ? prev : curr));
	return artUrl(best.url);
}

export function typeLabel(t: string): string | null {
	if (t === "ALBUM") return "Album";
	if (t === "SINGLE" || t === "EP") return "Single/EP";
	if (t === "COMPILATION") return "Compilation";
	return null;
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R[]>): Promise<R[]> {
	const out: R[] = [];
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (cursor < items.length) {
			const item = items[cursor++];
			try {
				out.push(...(await fn(item)));
			} catch {
				/* one artist failing must not sink the feed */
			}
		}
	};
	const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
	await Promise.all(workers);
	return out;
}

// A release can surface under several followed artists; keep the first.
export function dedupeAndSort(releases: Release[]): Release[] {
	const seen = new Set<string>();
	const deduped = releases.filter((r) => (seen.has(r.uri) ? false : (seen.add(r.uri), true)));
	return deduped.sort((a, b) => b.time - a.time);
}

export function filterVisible(
	releases: Release[],
	cfg: { range: number; album: boolean; singleEp: boolean; compilations: boolean },
	dismissed: Set<string>,
	now: number,
): Release[] {
	const cutoff = now - cfg.range * DAY_MS;
	const typeOn = (label: string): boolean =>
		label === "Album" ? cfg.album : label === "Single/EP" ? cfg.singleEp : cfg.compilations;
	return releases.filter((r) => r.time >= cutoff && typeOn(r.type) && !dismissed.has(r.uri));
}

export interface CacheShape {
	v: number;
	fetchedAt: number;
	releases: Release[];
}

export function validateCache(parsed: unknown, version: number): CacheShape | null {
	const cache = parsed as CacheShape | null;
	if (!cache || cache.v !== version || !Array.isArray(cache.releases)) return null;
	return cache;
}

export interface Group {
	label: string;
	items: Release[];
}

export function groupByDay(items: Release[], relative: boolean, locale: string, now: number): Group[] {
	const abs = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit" });
	const rel = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	const startOfToday = new Date(now).setHours(0, 0, 0, 0);

	const labelFor = (time: number): string => {
		if (!relative) return abs.format(time);
		const days = Math.round((new Date(time).setHours(0, 0, 0, 0) - startOfToday) / DAY_MS);
		return rel.format(days, "day");
	};

	const groups: Group[] = [];
	let current: Group | undefined;
	for (const item of items) {
		const label = labelFor(item.time);
		if (!current || current.label !== label) {
			current = { label, items: [] };
			groups.push(current);
		}
		current.items.push(item);
	}
	return groups;
}
