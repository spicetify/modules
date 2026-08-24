/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Characterization of the provider parsers - the code most likely to break
// when an external lyrics API shifts, shipped for years with no coverage.
// Everything here runs with NO Spicetify global: module-scope client access
// would throw at import, which is half the contract (plan R2).

import "../../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ProviderGenius } from "./genius.ts";
import { ProviderLRCLIB } from "./lrclib.ts";
import {
	ProviderMusixmatch,
	isMusixmatchTokenValid,
	musixmatchTokenListeners,
	setMusixmatchTokenValid,
} from "./musixmatch.ts";
import { createProviders } from "./index.ts";
import { ProviderNetease } from "./netease.ts";
import { configureLyricsClient } from "../runtime-client.ts";

describe("import contract", () => {
	it("all four providers import with no client present", () => {
		assert.equal(typeof (globalThis as never as Record<string, unknown>).Spicetify, "undefined");
		for (const p of [ProviderGenius, ProviderLRCLIB, ProviderMusixmatch, ProviderNetease]) {
			assert.equal(typeof p, "object");
		}
	});

	it("each provider keeps its real surface - they are not uniform", () => {
		assert.deepEqual(Object.keys(ProviderLRCLIB).sort(), ["findLyrics", "getSynced", "getUnsynced"]);
		assert.deepEqual(Object.keys(ProviderNetease).sort(), [
			"findLyrics",
			"getKaraoke",
			"getSynced",
			"getTranslation",
			"getUnsynced",
		]);
		assert.deepEqual(Object.keys(ProviderMusixmatch).sort(), [
			"findLyrics",
			"getKaraoke",
			"getLanguages",
			"getSynced",
			"getTranslation",
			"getUnsynced",
		]);
		// Genius has no getSynced/getUnsynced at all - by design.
		assert.deepEqual(Object.keys(ProviderGenius).sort(), ["fetchLyrics", "fetchLyricsVersion", "getNote"]);
	});
});

describe("ProviderLRCLIB", () => {
	const body = JSON.parse(readFileSync(path.join(import.meta.dirname, "__fixtures__", "lrclib-synced.json"), "utf8"));

	it("parses the captured fixture into synced entries", () => {
		const synced = ProviderLRCLIB.getSynced(body, 225000);
		assert.deepEqual(synced?.[0], { text: "We're talking away", startTime: 34130 });
		assert.equal(synced?.length, 4);
	});

	it("parses the plain half as unsynced", () => {
		assert.equal(ProviderLRCLIB.getUnsynced(body, 225000)?.length, 4);
	});

	it("returns the instrumental placeholder for instrumental tracks", () => {
		assert.deepEqual(ProviderLRCLIB.getSynced({ instrumental: true }, 0), [{ text: "♪ Instrumental ♪" }]);
		assert.deepEqual(ProviderLRCLIB.getUnsynced({ instrumental: true }, 0), [{ text: "♪ Instrumental ♪" }]);
	});

	it("returns null when the body carries no lyrics", () => {
		assert.equal(ProviderLRCLIB.getSynced({}, 0), null);
		assert.equal(ProviderLRCLIB.getUnsynced({}, 0), null);
	});

	it("takes the duration as an argument - the caller decides which track's (KTD5a)", () => {
		// A karaoke-style line with a missing end timestamp resolves against
		// the supplied duration, with no client read anywhere.
		const karaoke = { syncedLyrics: "[00:10.00] <00:10.00>Hi", plainLyrics: "Hi" };
		assert.doesNotThrow(() => ProviderLRCLIB.getSynced(karaoke, 75000));
	});
});

describe("ProviderNetease", () => {
	it("parses lrc lines into millisecond entries and drops metadata tags", () => {
		const list = { lrc: { lyric: "[00:12.34] Hello\n[00:15.00] World\n[ar:Artist]" } };
		assert.deepEqual(ProviderNetease.getSynced(list), [
			{ startTime: 12340, text: "Hello" },
			{ startTime: 15000, text: "World" },
		]);
	});

	it("treats the pure-music marker as having no lyrics", () => {
		assert.equal(ProviderNetease.getSynced({ lrc: { lyric: "[00:01.00] 纯音乐, 请欣赏" } }), null);
	});

	it("returns null for absent karaoke and translation payloads", () => {
		assert.equal(ProviderNetease.getKaraoke({}), null);
		assert.equal(ProviderNetease.getTranslation({}), null);
	});

	it("parses karaoke start times from the [start,duration] format", () => {
		const out = ProviderNetease.getKaraoke({ klyric: { lyric: "[1000,2000] Hi" } });
		assert.equal(out?.[0]?.startTime, 1000);
	});

	it("parses translations with the same lrc timestamps", () => {
		assert.deepEqual(ProviderNetease.getTranslation({ tlyric: { lyric: "[00:12.34] 你好" } }), [
			{ startTime: 12340, text: "你好" },
		]);
	});
});

describe("ProviderMusixmatch", () => {
	const subtitle = JSON.stringify([
		{ text: "Line one", time: { total: 12.3 } },
		{ text: "Line two", time: { total: 15 } },
	]);
	const body = {
		"matcher.track.get": {
			message: { body: { track: { has_subtitles: true, instrumental: false, has_lyrics: true } } },
		},
		"track.subtitles.get": { message: { body: { subtitle_list: [{ subtitle: { subtitle_body: subtitle } }] } } },
		"track.lyrics.get": { message: { body: { lyrics: { lyrics_body: "Free text\nSecond" } } } },
	};

	it("parses the subtitle body into synced entries with second-to-ms times", () => {
		assert.deepEqual(ProviderMusixmatch.getSynced(body), [
			{ text: "Line one", startTime: 12300, performer: null },
			{ text: "Line two", startTime: 15000, performer: null },
		]);
	});

	it("splits the lyrics body into unsynced entries", () => {
		assert.deepEqual(ProviderMusixmatch.getUnsynced(body), [
			{ text: "Free text", performer: null },
			{ text: "Second", performer: null },
		]);
	});

	it("returns the instrumental placeholder and null for missing metadata", () => {
		assert.deepEqual(
			ProviderMusixmatch.getSynced({
				"matcher.track.get": { message: { body: { track: { instrumental: true } } } },
			}),
			[{ text: "♪ Instrumental ♪", startTime: "0000" }],
		);
		assert.equal(ProviderMusixmatch.getSynced({}), null);
	});

	it("loads compact karaoke from the macro response without another request", async () => {
		const requests: string[] = [];
		const macroCalls = {
			"matcher.track.get": {
				message: {
					header: { status_code: 200 },
					body: {
						track: {
							has_richsync: true,
							instrumental: false,
						},
					},
				},
			},
			"track.lyrics.get": { message: { body: {} } },
			"track.richsync.get": {
				message: {
					header: { status_code: 200 },
					body: {
						richsync: {
							richsync_body: JSON.stringify([
								{
									ts: 1,
									te: 3,
									l: [
										{ c: "Hello", o: 0 },
										{ c: " world", o: 1.5 },
									],
								},
							]),
						},
					},
				},
			},
		};
		configureLyricsClient({
			cosmos: {
				get: async (url) => {
					requests.push(url);
					return { message: { header: { status_code: 200 }, body: { macro_calls: macroCalls } } };
				},
			},
		});

		const lyrics = await ProviderMusixmatch.findLyrics({
			album: "Album",
			artist: "Artist",
			duration: 3000,
			title: "Track",
			uri: "spotify:track:test",
		});
		const karaoke = await ProviderMusixmatch.getKaraoke(lyrics);
		const request = new URL(requests[0]);

		assert.equal(request.searchParams.get("optional_calls"), "track.richsync");
		assert.equal(request.searchParams.get("richsync_compact_type"), "words");
		assert.equal(requests.length, 1);
		assert.deepEqual(karaoke, [
			{
				startTime: 1000,
				endTime: 3000,
				text: [
					{ word: "Hello", time: 1500 },
					{ word: " world", time: 500 },
				],
				performer: null,
			},
		]);
	});

	it("returns null for incomplete optional richsync responses", async () => {
		const matcher = {
			"matcher.track.get": {
				message: { body: { track: { has_richsync: true, instrumental: false } } },
			},
		};

		assert.equal(await ProviderMusixmatch.getKaraoke(matcher), null);
		assert.equal(
			await ProviderMusixmatch.getKaraoke({
				...matcher,
				"track.richsync.get": { message: { header: { status_code: 500 } } },
			}),
			null,
		);
		assert.equal(
			await ProviderMusixmatch.getKaraoke({
				...matcher,
				"track.richsync.get": { message: { header: { status_code: 200 } } },
			}),
			null,
		);

		const withRichsyncBody = (richsync_body) => ({
			...matcher,
			"track.richsync.get": {
				message: {
					header: { status_code: 200 },
					body: { richsync: { richsync_body } },
				},
			},
		});
		assert.equal(await ProviderMusixmatch.getKaraoke(withRichsyncBody("not json")), null);
		assert.equal(await ProviderMusixmatch.getKaraoke(withRichsyncBody("{}")), null);
		assert.equal(await ProviderMusixmatch.getKaraoke(withRichsyncBody(JSON.stringify([{ ts: 1, te: 2 }]))), null);
	});

	it("token state notifies subscribers only on real transitions", () => {
		const seen: boolean[] = [];
		const listener = (v: boolean) => seen.push(v);
		musixmatchTokenListeners.add(listener);
		const initial = isMusixmatchTokenValid();
		setMusixmatchTokenValid(initial); // no-op: same value
		setMusixmatchTokenValid(!initial);
		setMusixmatchTokenValid(initial);
		musixmatchTokenListeners.delete(listener);
		setMusixmatchTokenValid(!initial);
		setMusixmatchTokenValid(initial); // restore
		assert.deepEqual(seen, [!initial, initial]);
	});
});

describe("createProviders registry", () => {
	const providers = createProviders({
		trackDurationMs: () => 0,
		simplifyChinese: async (s) => s,
		spicetifyVersion: () => "3.2.0",
	});

	it("exposes exactly the six entries, all callable", () => {
		assert.deepEqual(Object.keys(providers).sort(), [
			"genius",
			"local",
			"lrclib",
			"musixmatch",
			"netease",
			"spotify",
		]);
		for (const v of Object.values(providers)) assert.equal(typeof v, "function");
	});

	it("local resolves stored lyrics and reports 'No lyrics' otherwise", () => {
		localStorage.setItem(
			"lyrics-plus:local-lyrics",
			JSON.stringify({ "spotify:track:x": { synced: [{ text: "hi" }] } }),
		);
		const hit = providers.local({ uri: "spotify:track:x" });
		assert.deepEqual(hit.synced, [{ text: "hi" }]);
		assert.equal(hit.provider, "local");
		const miss = providers.local({ uri: "spotify:track:absent" }) as { error?: string };
		assert.equal(miss.error, "No lyrics");
		localStorage.removeItem("lyrics-plus:local-lyrics");
	});

	it("imports clean with stub deps - client policy is injected, not read", () => {
		assert.equal(typeof (globalThis as never as Record<string, unknown>).Spicetify, "undefined");
	});

	it("injects the Spicetify version into LRCLIB's user agent", async () => {
		const originalFetch = globalThis.fetch;
		let userAgent: string | undefined;
		globalThis.fetch = (async (_input, init) => {
			userAgent = new Headers(init?.headers).get("x-user-agent") ?? undefined;
			return { status: 200, json: async () => ({ plainLyrics: "line" }) } as Response;
		}) as typeof fetch;
		try {
			await providers.lrclib({
				uri: "spotify:track:test",
				title: "Title",
				artist: "Artist",
				album: "Album",
				duration: 1000,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
		assert.equal(userAgent, "spicetify v3.2.0 (https://github.com/spicetify/cli)");
	});
});
