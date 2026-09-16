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
import { createProviders, parseCachedLyrics } from "./index.ts";
import { ProviderNetease } from "./netease.ts";
import { configureLyricsClient } from "../runtime-client.ts";
import { CONFIG } from "../config.ts";

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

describe("ProviderGenius", () => {
	it("reads verified annotations and nested text from the provider response", async () => {
		configureLyricsClient({
			cosmos: {
				get: async (url) =>
					url.includes("/annotations/")
						? { response: { referent: { classification: "verified" } } }
						: {
								response: {
									referent: {
										annotations: [
											{
												body: {
													dom: {
														children: [
															{ children: ["Verified ", { children: ["meaning"] }] },
															"Second paragraph",
														],
													},
												},
											},
										],
									},
								},
							},
			},
		});
		assert.equal(await ProviderGenius.getNote("123"), "Verified meaning\nSecond paragraph");
	});

	it("keeps the search versions and extracts lyric containers from fetched HTML", async () => {
		const previousParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
		const previousRequest = Object.getOwnPropertyDescriptor(window, "sendCosmosRequest");
		Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: window.DOMParser });
		window.sendCosmosRequest = ({ onSuccess }) =>
			onSuccess?.(
				JSON.stringify({ body: '<main><div data-lyrics-container="true">Hello<br>world</div></main>' }),
			);
		configureLyricsClient({
			cosmos: {
				get: async () => ({
					response: {
						sections: [
							{
								hits: [
									{
										result: {
											full_title: "Track by Artist",
											url: "https://genius.com/artist-track-lyrics",
										},
									},
									{ result: { full_title: "Malformed", url: 42 } },
								],
							},
						],
					},
				}),
			},
		});
		try {
			assert.deepEqual(await ProviderGenius.fetchLyrics({ title: "Track", artist: "Artist" }), {
				lyrics: "Hello<br>world<br>",
				versions: [{ title: "Track by Artist", url: "https://genius.com/artist-track-lyrics" }],
			});
		} finally {
			if (previousParser) Object.defineProperty(globalThis, "DOMParser", previousParser);
			else Reflect.deleteProperty(globalThis, "DOMParser");
			if (previousRequest) Object.defineProperty(window, "sendCosmosRequest", previousRequest);
			else Reflect.deleteProperty(window, "sendCosmosRequest");
		}
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
		assert.deepEqual(ProviderLRCLIB.getSynced({ instrumental: true }, 0), [
			{ text: "♪ Instrumental ♪", startTime: 0 },
		]);
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
			[{ text: "♪ Instrumental ♪", startTime: 0 }],
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

		const withRichsyncBody = (richsync_body: string) => ({
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

	it("keeps performer tagging and translation metadata when decoding macro calls", async () => {
		configureLyricsClient({
			cosmos: {
				get: async () => ({
					message: {
						header: { status_code: 200 },
						body: {
							macro_calls: {
								"matcher.track.get": {
									message: {
										header: { status_code: 200 },
										body: {
											track: {
												track_id: 42,
												has_subtitles: 1,
												track_lyrics_translation_status: [
													{ to: "fr" },
													{ to: "fr" },
													{ to: "ja" },
												],
												performer_tagging: {
													content: [
														{
															snippet: "Line one",
															performers: [{ type: "artist", fqid: "artist:id:7" }],
														},
													],
													resources: {
														artists: { lead: { artist_id: 7, artist_name: "Singer" } },
													},
												},
											},
										},
									},
								},
								"track.subtitles.get": body["track.subtitles.get"],
							},
						},
					},
				}),
			},
		});
		const lyrics = await ProviderMusixmatch.findLyrics({
			uri: "spotify:track:test",
			title: "Track",
			artist: "Singer",
			album: "Album",
			duration: 3000,
		});
		assert.deepEqual(lyrics.__musixmatchTranslationStatus, ["fr", "ja"]);
		assert.equal(lyrics.__musixmatchTrackId, 42);
		assert.deepEqual(ProviderMusixmatch.getSynced(lyrics), [
			{ text: "Line one", startTime: 12300, performer: "Singer" },
			{ text: "Line two", startTime: 15000, performer: null },
		]);
	});

	it("refreshes an expired token once and decodes the retried translation", async () => {
		const token = CONFIG.providers.musixmatch.token;
		const language = CONFIG.visual["musixmatch-translation-language"];
		const storedToken = localStorage.getItem("lyrics-plus:provider:musixmatch:token");
		const requests: URL[] = [];
		CONFIG.visual["musixmatch-translation-language"] = "fr";
		configureLyricsClient({
			cosmos: {
				get: async (url) => {
					const request = new URL(url);
					requests.push(request);
					if (request.pathname.endsWith("token.get"))
						return {
							message: { header: { status_code: 200 }, body: { user_token: "refreshed-test-token" } },
						};
					if (request.searchParams.get("usertoken") !== "refreshed-test-token")
						return { message: { header: { status_code: 401 } } };
					return {
						message: {
							header: { status_code: 200 },
							body: {
								translations_list: [{ translation: { description: "Bonjour", matched_line: "Hello" } }],
							},
						},
					};
				},
			},
		});
		try {
			assert.deepEqual(await ProviderMusixmatch.getTranslation(42), [
				{ translation: "Bonjour", matchedLine: "Hello" },
			]);
			assert.equal(requests.length, 3);
			assert.equal(requests.filter((request) => request.pathname.endsWith("token.get")).length, 1);
			assert.equal(requests[2].searchParams.get("selected_language"), "fr");
		} finally {
			CONFIG.providers.musixmatch.token = token;
			CONFIG.visual["musixmatch-translation-language"] = language;
			if (storedToken === null) localStorage.removeItem("lyrics-plus:provider:musixmatch:token");
			else localStorage.setItem("lyrics-plus:provider:musixmatch:token", storedToken);
		}
	});

	it("does not cache an absent language list as a successful empty result", async () => {
		const cached = localStorage.getItem("lyrics-plus:musixmatch-languages");
		localStorage.removeItem("lyrics-plus:musixmatch-languages");
		let requests = 0;
		configureLyricsClient({
			cosmos: {
				get: async () => {
					requests++;
					return requests === 1
						? { message: { header: { status_code: 200 }, body: {} } }
						: {
								message: {
									header: { status_code: 200 },
									body: {
										language_list: [
											{
												language: {
													language_name: "french",
													language_iso_code_1: "fr",
													language_iso_code_3: "fra",
												},
											},
										],
									},
								},
							};
				},
			},
		});
		try {
			assert.deepEqual(await ProviderMusixmatch.getLanguages(), {});
			assert.deepEqual(await ProviderMusixmatch.getLanguages(), { fr: "French", fra: "French" });
			assert.equal(requests, 2);
		} finally {
			if (cached === null) localStorage.removeItem("lyrics-plus:musixmatch-languages");
			else localStorage.setItem("lyrics-plus:musixmatch-languages", cached);
		}
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
			JSON.stringify({ "spotify:track:x": { synced: [{ text: "hi", startTime: 0 }] } }),
		);
		const hit = providers.local({ uri: "spotify:track:x" });
		assert.deepEqual(hit.synced, [{ text: "hi", startTime: 0 }]);
		assert.equal(hit.provider, "local");
		const miss = providers.local({ uri: "spotify:track:absent" });
		assert.equal(miss.error, "No lyrics");
		localStorage.removeItem("lyrics-plus:local-lyrics");
	});

	it("normalizes Spotify timestamp strings and drops unusable timed lines", async () => {
		configureLyricsClient({
			cosmos: {
				get: async () => ({
					lyrics: {
						syncType: "LINE_SYNCED",
						lines: [
							{ words: "Hello", startTimeMs: "1200" },
							{ words: "World", startTimeMs: 2400 },
							{ words: "Invalid", startTimeMs: "not a time" },
						],
					},
				}),
			},
		});
		const lyrics = await providers.spotify({ uri: "spotify:track:test" });
		assert.deepEqual(lyrics.synced, [
			{ text: "Hello", startTime: 1200 },
			{ text: "World", startTime: 2400 },
		]);
		assert.equal(lyrics.unsynced, lyrics.synced);
	});

	it("rejects malformed cached timings and preserves saved translation metadata", () => {
		assert.equal(parseCachedLyrics({ synced: [{ text: "missing timestamp" }] }), null);
		assert.equal(parseCachedLyrics({ karaoke: [{ startTime: 0, text: [{ word: "bad", time: "100" }] }] }), null);
		const cached = parseCachedLyrics({
			synced: [{ text: "Hello", startTime: 1200 }],
			musixmatchTranslation: [{ text: "Bonjour", originalText: "Hello", startTime: 1200 }],
			musixmatchAvailableTranslations: ["fr"],
			musixmatchTrackId: 42,
			musixmatchTranslationLanguage: "fr",
			provider: "Musixmatch",
			copyright: "Copyright",
		});
		assert.equal(cached?.provider, "Musixmatch");
		assert.equal(cached?.copyright, "Copyright");
		assert.equal(cached?.musixmatchTranslation?.[0].text, "Bonjour");
		assert.deepEqual(cached?.musixmatchAvailableTranslations, ["fr"]);
		assert.equal(cached?.musixmatchTrackId, 42);
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
