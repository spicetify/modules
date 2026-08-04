/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// These parsers shipped for years with no coverage. They are pure now, so
// they can be pinned directly — no client, no DOM.

// detectLanguage reads CONFIG thresholds, and CONFIG reads localStorage at
// import, so the DOM harness has to load first.
import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	capitalize,
	containsHanCharacter,
	convertIntToRGB,
	convertParsedToLRC,
	convertParsedToUnsynced,
	detectLanguage,
	formatTime,
	parseLocalLyrics,
	removeExtraInfo,
	removeSongFeat,
} from "./utils.ts";

const SYNCED_LRC = [
	"[00:34.13] We're talking away",
	"[00:36.92] I don't know what I'm to say",
	"[00:39.54] I'll say it anyway",
].join("\n");

describe("parseLocalLyrics", () => {
	it("parses a synced LRC body into timed entries", () => {
		const { synced } = parseLocalLyrics(SYNCED_LRC);
		assert.equal(synced.length, 3);
		assert.equal(synced[0].text, "We're talking away");
		assert.equal(synced[0].startTime, 34130);
		assert.equal(synced[1].startTime, 36920);
		// Entries stay in file order.
		assert.ok(synced[2].startTime > synced[1].startTime);
	});

	it("parses a plain-text body as unsynced, leaving synced null", () => {
		const { synced, unsynced } = parseLocalLyrics("first line\nsecond line");
		assert.deepEqual(
			unsynced.map((l) => l.text),
			["first line", "second line"],
		);
		// null rather than an empty array — callers test for falsiness.
		assert.equal(synced, null);
	});

	it("parses word-level karaoke markers into per-word timings", () => {
		const { karaoke } = parseLocalLyrics("[00:10.00] <00:10.00>Hello <00:10.50>world<00:11.00>");
		assert.equal(karaoke.length, 1);
		assert.equal(karaoke[0].startTime, 10000);
		// Upstream quirk, pinned rather than corrected: the first word keeps its
		// leading timestamp because the split consumes only separators after it.
		assert.deepEqual(
			karaoke[0].text.map((w) => w.word),
			["<00:10.00>Hello ", "world"],
		);
		assert.deepEqual(
			karaoke[0].text.map((w) => w.time),
			[500, 500],
		);
	});

	it("uses the supplied duration as the karaoke end-time fallback", () => {
		// The closing <mm:ss.xx> is absent, so the parser falls back. Passing a
		// duration is what replaced the old client read.
		const withDuration = parseLocalLyrics("[00:10.00] <00:10.00>Hello", 75000);
		const last = withDuration.karaoke[0].text.at(-1);
		assert.equal(last.time, 65000, "end time should be duration minus the word start");
	});

	it("treats a zero duration as the fallback default", () => {
		const parsed = parseLocalLyrics("[00:10.00] <00:10.00>Hello");
		assert.equal(parsed.karaoke.length, 1);
	});

	it("returns an empty unsynced list for an empty body without throwing", () => {
		const { synced, unsynced, karaoke } = parseLocalLyrics("");
		assert.equal(synced, null);
		assert.deepEqual(unsynced, []);
		assert.equal(karaoke, null);
	});

	it("reads no client state", () => {
		// Guards the KTD5 contract: the module must not reach for Spicetify.
		assert.equal(typeof globalThis.Spicetify, "undefined");
		assert.doesNotThrow(() => parseLocalLyrics(SYNCED_LRC, 1000));
	});
});

describe("formatTime", () => {
	it("renders milliseconds as mm:ss.xx", () => {
		assert.equal(formatTime(0), "00:00.00");
		assert.equal(formatTime(34130), "00:34.13");
		assert.equal(formatTime(65000), "01:05.00");
	});
});

describe("convertParsedToLRC", () => {
	it("round-trips synced entries back into LRC timestamps", () => {
		const { synced } = parseLocalLyrics(SYNCED_LRC);
		const { original, conver } = convertParsedToLRC(synced, false);
		assert.match(original, /\[00:34\.13\]/);
		assert.ok(original.includes("We're talking away"));
		// The translated track stays empty unless isBelow requested it.
		assert.equal(conver, "");
	});

	it("emits both tracks when isBelow is set", () => {
		const entries = [{ startTime: 1000, text: "translated", originalText: "original" }];
		const { original, conver } = convertParsedToLRC(entries, true);
		assert.ok(original.includes("original"));
		assert.ok(conver.includes("translated"));
	});
});

describe("convertParsedToUnsynced", () => {
	it("emits one untimed line per entry", () => {
		const { synced } = parseLocalLyrics(SYNCED_LRC);
		const { original } = convertParsedToUnsynced(synced, false);
		assert.equal(original.trim().split("\n").length, 3);
		assert.doesNotMatch(original, /\[\d/);
	});
});

describe("string helpers", () => {
	it("removeSongFeat strips a trailing feature credit", () => {
		assert.equal(removeSongFeat("Song (feat. Someone)").trim(), "Song");
		assert.equal(removeSongFeat("Plain Title"), "Plain Title");
	});

	it("removeExtraInfo strips a trailing parenthetical", () => {
		assert.equal(removeExtraInfo("Song - Remastered").trim(), "Song");
	});

	it("capitalize uppercases the first character", () => {
		assert.equal(capitalize("hello"), "Hello");
	});

	it("containsHanCharacter distinguishes Han from Latin", () => {
		assert.equal(containsHanCharacter("漢字"), true);
		assert.equal(containsHanCharacter("latin"), false);
	});
});

describe("detectLanguage", () => {
	const lines = (text) => [{ text }];

	it("detects Japanese", () => {
		assert.equal(detectLanguage(lines("ひらがなカタカナ漢字のテスト")), "ja");
	});

	it("detects Korean", () => {
		assert.equal(detectLanguage(lines("한국어 가사 테스트입니다")), "ko");
	});

	it("returns undefined for Latin text", () => {
		assert.equal(detectLanguage(lines("just plain english lyrics")), undefined);
	});
});

describe("convertIntToRGB", () => {
	it("converts a packed integer to a css rgb() string", () => {
		assert.equal(convertIntToRGB(0xff0000), "rgb(255,0,0)");
		assert.equal(convertIntToRGB(0x000000), "rgb(0,0,0)");
	});
});
