/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
	loadPreviewBlob,
	MAX_PREVIEW_BYTES,
	PREVIEW_CACHE_NAME,
	previewCacheKey,
	previewRevision,
	prunePreviewCache,
} from "./previewCache.ts";

class MemoryCache {
	readonly records = new Map<string, Response>();

	async match(key: string): Promise<Response | undefined> {
		return this.records.get(key)?.clone();
	}

	async put(key: string, response: Response): Promise<void> {
		this.records.set(key, response.clone());
	}

	async delete(key: string): Promise<boolean> {
		return this.records.delete(key);
	}

	async keys(): Promise<Request[]> {
		return [...this.records.keys()].map((key) => new Request(key));
	}
}

class MemoryCacheStorage {
	readonly cache = new MemoryCache();
	opened: string[] = [];

	async open(name: string): Promise<MemoryCache> {
		this.opened.push(name);
		return this.cache;
	}
}

const image = (body = "preview", type = "image/png") =>
	new Response(body, { headers: { "content-length": String(body.length), "content-type": type } });

describe("preview cache", () => {
	it("drives both Store preview surfaces and prunes after catalog refresh", () => {
		const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
		assert.equal([...page.matchAll(/<CachedPreviewImage\b/g)].length, 2);
		assert.match(page, /new IntersectionObserver/);
		assert.match(page, /void prunePreviewCache/);
	});

	it("keys artwork by its semantic module release and vault date", () => {
		assert.equal(previewRevision("1.2.3+cm-1020096-deadbeef", "2026-08-14"), "1.2.3@2026-08-14");
		assert.notEqual(
			previewCacheKey("https://example.test/a.png", "1.0.0"),
			previewCacheKey("https://example.test/a.png", "1.0.1"),
		);
	});

	it("fetches a miss once and serves later reads from persistent storage", async () => {
		const cacheStorage = new MemoryCacheStorage();
		let fetches = 0;
		const options = {
			cacheStorage,
			fetcher: async () => {
				fetches++;
				return image();
			},
		};

		assert.equal((await loadPreviewBlob("https://example.test/a.png", "1.0.0", options))?.size, 7);
		assert.equal((await loadPreviewBlob("https://example.test/a.png", "1.0.0", options))?.size, 7);
		assert.equal(fetches, 1);
		assert.deepEqual(cacheStorage.opened, [PREVIEW_CACHE_NAME, PREVIEW_CACHE_NAME]);
	});

	it("deduplicates concurrent downloads of the same preview", async () => {
		const cacheStorage = new MemoryCacheStorage();
		let fetches = 0;
		const options = {
			cacheStorage,
			fetcher: async () => {
				fetches++;
				await Promise.resolve();
				return image();
			},
		};

		const [first, second] = await Promise.all([
			loadPreviewBlob("https://example.test/shared.png", "1.0.0", options),
			loadPreviewBlob("https://example.test/shared.png", "1.0.0", options),
		]);
		assert.equal(first?.size, 7);
		assert.equal(second?.size, 7);
		assert.equal(fetches, 1);
	});

	it("rejects non-images and oversized responses without caching them", async () => {
		for (const response of [
			new Response("not an image", { headers: { "content-type": "text/html" } }),
			new Response("x", {
				headers: { "content-length": String(MAX_PREVIEW_BYTES + 1), "content-type": "image/png" },
			}),
		]) {
			const cacheStorage = new MemoryCacheStorage();
			assert.equal(
				await loadPreviewBlob("https://example.test/b.png", "1.0.0", {
					cacheStorage,
					fetcher: async () => response,
				}),
				null,
			);
			assert.equal(cacheStorage.cache.records.size, 0);
		}
	});

	it("falls back without issuing a duplicate fetch when Cache Storage is unavailable", async () => {
		let fetched = false;
		assert.equal(
			await loadPreviewBlob("https://example.test/c.png", "1.0.0", {
				fetcher: async () => {
					fetched = true;
					return image();
				},
			}),
			null,
		);
		assert.equal(fetched, false);
	});

	it("prunes stale revisions and caps retained current previews", async () => {
		const cacheStorage = new MemoryCacheStorage();
		const current = ["a", "b", "c"].map((name) => ({
			url: `https://example.test/${name}.png`,
			revision: "2.0.0",
		}));
		for (const entry of current) {
			await cacheStorage.cache.put(previewCacheKey(entry.url, entry.revision), image());
		}
		await cacheStorage.cache.put(previewCacheKey(current[0]!.url, "1.0.0"), image());

		await prunePreviewCache(current, { cacheStorage, maxEntries: 2 });

		assert.deepEqual(
			[...cacheStorage.cache.records.keys()],
			current.slice(1).map((entry) => previewCacheKey(entry.url, entry.revision)),
		);
	});
});
