import "../stdlib/lib/test-setup.mts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createModuleQueryClient } from "../stdlib/query.ts";
import { LyricsQueries } from "./queries.ts";
import { CONFIG } from "./config.ts";
import type { ProviderResult, TrackInfo } from "./types.ts";

const track: TrackInfo = {
	uri: "spotify:track:test",
	title: "Song",
	artist: "Artist",
	album: "Album",
	duration: 180000,
};
const result: ProviderResult = { uri: track.uri, provider: "test", synced: [{ text: "line", startTime: 0 }] };

test("prefetch and foreground share a query; mode and provider settings select fresh data", async () => {
	const client = createModuleQueryClient({ defer: () => {} });
	const queries = new LyricsQueries(client);
	let calls = 0;
	let finish: (value: ProviderResult) => void = () => {};
	const load = () => {
		calls++;
		return new Promise<ProviderResult>((resolve) => {
			finish = resolve;
		});
	};
	const before = CONFIG.providers.spotify.on;
	try {
		const prefetch = queries.fetch(track, -1, load);
		const foreground = queries.fetch(track, -1, load);
		assert.equal(calls, 1);
		finish(result);
		await Promise.all([prefetch, foreground]);
		await queries.fetch(track, -1, load);
		assert.equal(calls, 1);
		assert.equal(queries.get(track.uri, -1)?.provider, "test");
		await queries.fetch(track, 1, async () => {
			calls++;
			return result;
		});
		CONFIG.providers.spotify.on = !before;
		await queries.fetch(track, 1, async () => {
			calls++;
			return result;
		});
		assert.equal(calls, 3);
		assert.ok(
			!JSON.stringify(
				client
					.getQueryCache()
					.getAll()
					.map((q) => q.queryKey),
			).includes(CONFIG.providers.musixmatch.token),
		);
	} finally {
		CONFIG.providers.spotify.on = before;
		client.clear();
	}
});

test("reload cancels old queries, clears results and cannot resurrect a late response", async () => {
	const client = createModuleQueryClient({ defer: () => {} });
	const queries = new LyricsQueries(client);
	let finish: (value: ProviderResult) => void = () => {};
	let signal: AbortSignal | undefined;
	const pending = queries.fetch(track, -1, (context) => {
		signal = context;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const rejected = assert.rejects(pending);
	await queries.clear();
	finish(result);
	await rejected;
	assert.equal(signal?.aborted, true);
	assert.equal(queries.get(track.uri, -1), undefined);
	assert.equal(await queries.fetch(track, -1, async () => result), result);
	client.clear();
});

test("missing lyrics and failed requests remain retryable without automatic provider retries", async () => {
	const client = createModuleQueryClient({ defer: () => {} });
	const queries = new LyricsQueries(client);
	let calls = 0;
	try {
		await queries.fetch(track, -1, async () => {
			calls++;
			return { uri: track.uri };
		});
		await queries.fetch(track, -1, async () => {
			calls++;
			return result;
		});
		assert.equal(calls, 2);
		await queries.clear();
		await assert.rejects(
			queries.fetch(track, -1, async () => {
				calls++;
				throw new Error("offline");
			}),
			/offline/,
		);
		assert.equal(calls, 3);
	} finally {
		client.clear();
	}
});

test("partial display updates after a key change cannot replace unfetched provider data", async () => {
	const client = createModuleQueryClient({ defer: () => {} });
	const queries = new LyricsQueries(client);
	const before = CONFIG.visual["musixmatch-translation-language"];
	let calls = 0;
	try {
		await queries.fetch(track, -1, async () => {
			calls++;
			return result;
		});
		CONFIG.visual["musixmatch-translation-language"] = "different";
		queries.update(track.uri, -1, { romaji: null });
		assert.equal(queries.get(track.uri, -1), undefined);
		assert.equal(
			(
				await queries.fetch(track, -1, async () => {
					calls++;
					return result;
				})
			).provider,
			"test",
		);
		assert.equal(calls, 2);
	} finally {
		CONFIG.visual["musixmatch-translation-language"] = before;
		client.clear();
	}
});
