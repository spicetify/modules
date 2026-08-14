/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const PREVIEW_CACHE_NAME = "spicetify-store-previews-v1";
export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
export const MAX_CACHED_PREVIEWS = 128;

const PREVIEW_KEY_BASE = "https://xpui.app.spotify.com/__spicetify/store-preview";
const pendingLoads = new Map<string, Promise<Blob | null>>();

type PreviewCache = {
	match(key: string): Promise<Response | undefined>;
	put(key: string, response: Response): Promise<void>;
	delete(key: string): Promise<boolean>;
	keys(): Promise<readonly Request[]>;
};

type PreviewCacheStorage = {
	open(name: string): Promise<PreviewCache>;
};

type PreviewCacheOptions = {
	cacheStorage?: PreviewCacheStorage;
	fetcher?: (url: string) => Promise<Response>;
	maxBytes?: number;
	maxEntries?: number;
};

const runtimeCacheStorage = (): PreviewCacheStorage | undefined =>
	(globalThis as typeof globalThis & { caches?: PreviewCacheStorage }).caches;

export function previewRevision(version: string, updatedAt?: string): string {
	// A classmap build suffix does not change module artwork. The release and
	// vault date do, so they form a stable cache-busting revision instead.
	return `${version.split("+")[0]}@${updatedAt ?? "unknown"}`;
}

export function previewCacheKey(url: string, revision: string): string {
	const key = new URL(PREVIEW_KEY_BASE);
	key.searchParams.set("source", url);
	key.searchParams.set("revision", revision);
	return key.href;
}

async function imageBlob(response: Response, maxBytes: number): Promise<Blob | null> {
	if (!response.ok) return null;
	const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	if (!contentType.startsWith("image/")) return null;
	const declaredSize = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredSize) && declaredSize > maxBytes) return null;
	const blob = await response.blob();
	if (!blob.size || blob.size > maxBytes) return null;
	return blob;
}

async function trim(cache: PreviewCache, maxEntries: number): Promise<void> {
	const keys = await cache.keys();
	const overflow = keys.length - maxEntries;
	if (overflow <= 0) return;
	await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key.url)));
}

/**
 * Resolve a preview to a validated Blob. Cache Storage is deliberately
 * required: without it the caller falls back to a native lazy <img>, avoiding
 * a second eager fetch in clients where persistent caching is unavailable.
 */
export async function loadPreviewBlob(
	url: string,
	revision: string,
	options: PreviewCacheOptions = {},
): Promise<Blob | null> {
	const storage = options.cacheStorage ?? runtimeCacheStorage();
	if (!storage) return null;
	const maxBytes = options.maxBytes ?? MAX_PREVIEW_BYTES;
	const maxEntries = options.maxEntries ?? MAX_CACHED_PREVIEWS;
	const key = previewCacheKey(url, revision);

	let cache: PreviewCache;
	try {
		cache = await storage.open(PREVIEW_CACHE_NAME);
		const cached = await cache.match(key);
		if (cached) {
			const blob = await imageBlob(cached, maxBytes);
			if (blob) return blob;
			await cache.delete(key);
		}
	} catch {
		return null;
	}

	const fetcher = options.fetcher ?? ((source: string) => fetch(source, { credentials: "omit" }));
	const pending = pendingLoads.get(key);
	if (pending) return pending;
	const download = (async () => {
		let blob: Blob | null;
		try {
			blob = await imageBlob(await fetcher(url), maxBytes);
		} catch {
			return null;
		}
		if (!blob) return null;

		try {
			await cache.put(
				key,
				new Response(blob, {
					headers: {
						"content-length": String(blob.size),
						"content-type": blob.type,
					},
				}),
			);
			await trim(cache, maxEntries);
		} catch {
			// Quota and cache-write failures must not discard the image that was
			// already downloaded successfully for this render.
		}
		return blob;
	})();
	pendingLoads.set(key, download);
	try {
		return await download;
	} finally {
		if (pendingLoads.get(key) === download) pendingLoads.delete(key);
	}
}

/** Remove previews that no longer belong to the current successful catalog. */
export async function prunePreviewCache(
	current: Array<{ url: string; revision: string }>,
	options: Pick<PreviewCacheOptions, "cacheStorage" | "maxEntries"> = {},
): Promise<void> {
	const storage = options.cacheStorage ?? runtimeCacheStorage();
	if (!storage) return;
	try {
		const cache = await storage.open(PREVIEW_CACHE_NAME);
		const keep = new Set(current.map(({ url, revision }) => previewCacheKey(url, revision)));
		const keys = await cache.keys();
		const retained = keys.filter((key) => keep.has(key.url));
		const maxEntries = options.maxEntries ?? MAX_CACHED_PREVIEWS;
		const overflow = Math.max(0, retained.length - maxEntries);
		const evict = new Set([...keys.filter((key) => !keep.has(key.url)), ...retained.slice(0, overflow)]);
		await Promise.all([...evict].map((key) => cache.delete(key.url)));
	} catch {
		// Persistent caching is an enhancement. A denied or unavailable cache
		// never prevents the Store from using ordinary image URLs.
	}
}
