/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasLyricsPlus, parseConfig, progressFromPointer, rootClasses, thumbPercent } from "./logic.ts";

describe("hasLyricsPlus", () => {
	it("prefers the loaded v3 module and keeps the v2 fallbacks", () => {
		assert.equal(hasLyricsPlus([{ identifier: "lyrics-plus", loaded: true }], [], false), true);
		assert.equal(hasLyricsPlus([{ identifier: "lyrics-plus", loaded: false }], [], false), false);
		assert.equal(hasLyricsPlus([], ["lyrics-plus"], false), true);
		assert.equal(hasLyricsPlus([], [], true), true);
	});
});

describe("parseConfig", () => {
	it("parses stored objects, treats null/empty as an empty config", () => {
		assert.deepEqual(parseConfig(JSON.stringify({ vertical: true })), { vertical: true });
		assert.deepEqual(parseConfig(null), {});
		assert.deepEqual(parseConfig(""), {});
	});

	it("signals corrupt or non-object payloads with null so the caller can reset", () => {
		assert.equal(parseConfig("{oops"), null);
		assert.equal(parseConfig('"a string"'), null);
		assert.equal(parseConfig("42"), null);
	});
});

describe("progressFromPointer", () => {
	it("maps a pointer x inside the bar to track milliseconds", () => {
		assert.equal(progressFromPointer(150, 100, 200, 180000), 45000);
		assert.equal(progressFromPointer(100, 100, 200, 180000), 0);
		assert.equal(progressFromPointer(300, 100, 200, 180000), 180000);
	});
});

describe("thumbPercent", () => {
	it("is the elapsed fraction as a percentage", () => {
		assert.equal(thumbPercent(45000, 180000), 25);
	});
});

describe("rootClasses", () => {
	it("appends vertical and lyrics-plus flags onto the video base classes", () => {
		const base = "Video VideoPlayer--fullscreen VideoPlayer--landscape";
		assert.equal(rootClasses({}, false), base);
		assert.equal(rootClasses({ vertical: true }, false), `${base} fad-vertical`);
		assert.equal(rootClasses({ lyricsPlus: true }, true), `${base} fad-lyrics-plus`);
		// lyricsPlus config alone is not enough - the app must be present
		assert.equal(rootClasses({ lyricsPlus: true }, false), base);
		assert.equal(rootClasses({ vertical: true, lyricsPlus: true }, true), `${base} fad-vertical fad-lyrics-plus`);
	});
});
