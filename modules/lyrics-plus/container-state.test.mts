/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../stdlib/lib/test-setup.mts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { translationMode, renderedLines, plainLines, mergeProviderResult } from "./container-state.ts";
import type { DisplayLyricLine, ProviderResult } from "./types.ts";

test("translation modes follow the source language and reject invalid persisted values", () => {
	const visual = {
		"translation-mode:japanese": "furigana",
		"translation-mode:korean": "romaja",
		"translation-mode:chinese": "cn",
	};
	assert.equal(translationMode("ja", visual), "furigana");
	assert.equal(translationMode("ko", visual), "romaja");
	assert.equal(translationMode("zh-hant", visual), "cn");
	assert.equal(translationMode("en", visual), undefined);
	visual["translation-mode:japanese"] = "invalid";
	assert.equal(translationMode("ja", visual), undefined);
});

test("rendered lyric arrays retain identity and React children", () => {
	const children = ["original ", createElement("ruby", { key: "ruby" }, "word")];
	const lines: DisplayLyricLine[] = [{ text: children, startTime: 100 }];
	assert.equal(renderedLines(lines), lines);
	assert.equal(renderedLines(lines)[0].text, children);
	assert.equal(plainLines(lines)[0].text, "original word");
});

test("karaoke words become unsynced text without losing timing or original lyrics", () => {
	const lines: DisplayLyricLine[] = [
		{
			text: [
				{ word: "hello ", time: 30 },
				{ word: "world", time: 40 },
			],
			startTime: 100,
			originalText: "original",
			performer: "one",
		},
	];
	assert.deepEqual(renderedLines(lines), [
		{ text: "hello world", startTime: 100, originalText: "original", performer: "one" },
	]);
	assert.equal(Array.isArray(lines[0].text), true);
});

test("conversion uses original text for rendered translations", () => {
	const lines: DisplayLyricLine[] = [
		{ text: createElement("ruby", null, "translation"), originalText: "original", startTime: 250 },
	];
	assert.deepEqual(plainLines(lines), [{ text: "original", originalText: "original", startTime: 250 }]);
	assert.deepEqual(plainLines(null), []);
});

test("provider fallback fills missing lyrics and preserves first provider attribution", () => {
	const lines = [{ text: "words", startTime: 0 }];
	const first: ProviderResult = { uri: "track", provider: "first", synced: null };
	const second: ProviderResult = { uri: "track", provider: "second", synced: lines };
	mergeProviderResult(first, second);
	assert.equal(first.provider, "first");
	assert.equal(first.synced, lines);
	assert.equal(second.provider, "second");
});

test("provider fallback does not overwrite null fields omitted by the next provider", () => {
	const first: ProviderResult = { uri: "track", synced: null, neteaseTranslation: null };
	mergeProviderResult(first, { uri: "track", unsynced: [{ text: "words" }] });
	assert.equal(first.synced, null);
	assert.equal(first.neteaseTranslation, null);
	assert.equal(Object.hasOwn(first, "mode"), false);
});
