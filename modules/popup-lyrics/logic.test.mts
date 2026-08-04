/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Characterization of the popup-lyrics pure core. These parsers are
// deliberately NOT shared with lyrics-plus (different endpoints, second-based
// timestamps, error-string contract); the quirks pinned here are the shipped
// behavior of the classic extension, not aspirations.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	LyricUtils,
	parseLrclibBody,
	parseMusixmatchMacro,
	parseNeteaseLyrics,
	parseSpotifyLyrics,
	pickNeteaseTrack,
} from "./logic.ts";

describe("LyricUtils", () => {
	it("normalize maps fullwidth punctuation to ASCII and collapses whitespace", () => {
		assert.equal(LyricUtils.normalize("Song（Live）、Ver！"), "Song(Live), Ver!");
	});

	it("normalize leaves fullwidth LETTERS alone - only punctuation is mapped", () => {
		assert.equal(LyricUtils.normalize("（Ｄemo） Ｔitle！？"), "(Ｄemo) Ｔitle! ?");
	});

	it("removeExtraInfo strips feat/with/prod suffixes and dash tails", () => {
		assert.equal(LyricUtils.removeExtraInfo("Song - feat. Someone"), "Song");
		assert.equal(LyricUtils.removeExtraInfo("Song (feat. X)"), "Song");
		assert.equal(LyricUtils.removeExtraInfo("Song - Remastered 2003"), "Song");
	});

	it("capitalize uppercases only the first word character", () => {
		assert.equal(LyricUtils.capitalize("hello world"), "Hello world");
	});
});

describe("parseSpotifyLyrics", () => {
	it("converts LINE_SYNCED ms timestamps to seconds", () => {
		assert.deepEqual(
			parseSpotifyLyrics({
				lyrics: { syncType: "LINE_SYNCED", lines: [{ startTimeMs: "12340", words: "Hello" }] },
			}),
			{
				lyrics: [{ startTime: 12.34, text: "Hello" }],
			},
		);
	});

	it("rejects unsynced and absent lyrics", () => {
		assert.deepEqual(parseSpotifyLyrics({ lyrics: { syncType: "UNSYNCED", lines: [] } }), { error: "No lyrics" });
		assert.deepEqual(parseSpotifyLyrics({}), { error: "No lyrics" });
	});
});

describe("parseMusixmatchMacro", () => {
	const ok = {
		"matcher.track.get": {
			message: { header: { status_code: 200 }, body: { track: { has_subtitles: true, instrumental: false } } },
		},
		"track.lyrics.get": { message: { header: { status_code: 404 }, body: {} } },
		"track.subtitles.get": {
			message: {
				body: {
					subtitle_list: [
						{
							subtitle: {
								subtitle_body: JSON.stringify([
									{ text: "Hi", time: { total: 12.3 } },
									{ text: "", time: { total: 15 } },
								]),
							},
						},
					],
				},
			},
		},
	};

	it("parses the subtitle body, substituting ♪ for empty lines", () => {
		assert.deepEqual(parseMusixmatchMacro(ok), {
			lyrics: [
				{ text: "Hi", startTime: 12.3 },
				{ text: "♪", startTime: 15 },
			],
		});
	});

	it("surfaces the upstream header on non-200 matcher status", () => {
		assert.deepEqual(
			parseMusixmatchMacro({
				"matcher.track.get": { message: { header: { status_code: 401, hint: "renew", mode: "get" } } },
			}),
			{
				error: "Requested error: 401: renew - get",
			},
		);
	});

	it("returns an error result (not a throw) on malformed subtitle JSON", () => {
		const bad = {
			...ok,
			"track.subtitles.get": { message: { body: { subtitle_list: [{ subtitle: { subtitle_body: "{oops" } }] } } },
		};
		const out = parseMusixmatchMacro(bad);
		assert.equal(typeof out.error, "string");
		assert.equal(out.lyrics, undefined);
	});
});

describe("parseNeteaseLyrics", () => {
	it("parses lrc lines to seconds and drops credit lines", () => {
		assert.deepEqual(parseNeteaseLyrics("[00:12.34] Hello\n[00:15.00] World\n[00:01.00]作词 : Someone"), {
			lyrics: [
				{ startTime: 12.34, text: "Hello" },
				{ startTime: 15, text: "World" },
			],
		});
	});

	it("treats the pure-music marker as no lyrics", () => {
		assert.deepEqual(parseNeteaseLyrics("[00:01.00] 纯音乐, 请欣赏"), { error: "No lyrics" });
	});
});

describe("pickNeteaseTrack", () => {
	it("matches on album name (first-letter capitalize only) or duration within 1s", () => {
		// "my album" capitalizes to "My album", NOT "My Album" - so the album
		// comparison misses and the duration fallback decides. Shipped quirk.
		const items = [
			{ album: { name: "other" }, duration: 999999 },
			{ album: { name: "my album" }, duration: 200500 },
		];
		assert.equal(pickNeteaseTrack(items, { album: "My Album", duration: 200000 }), 1);
		assert.equal(pickNeteaseTrack(items, { album: "My Album", duration: 500000 }), -1);
		assert.equal(pickNeteaseTrack(items, { album: "My album", duration: 500000 }), 1);
	});
});

describe("parseLrclibBody", () => {
	it("parses synced lines to seconds and strips word-level <..> stamps", () => {
		assert.deepEqual(parseLrclibBody({ syncedLyrics: "[00:12.34] Hello <00:12.50>x\n[00:15.00] World" }), {
			lyrics: [
				{ text: "Hello x", startTime: 12.34 },
				{ text: "World", startTime: 15 },
			],
		});
	});

	it("reports instrumental and missing synced lyrics as errors", () => {
		assert.deepEqual(parseLrclibBody({ instrumental: true }), { error: "Instrumental" });
		assert.deepEqual(parseLrclibBody({}), { error: "No synced lyrics" });
	});
});
