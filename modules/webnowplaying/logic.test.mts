/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	nextRepeatState,
	pad,
	parsePositionPercentage,
	ratingShouldToggleHeart,
	timeInSecondsToString,
	togglePlayingState,
} from "./logic.ts";

describe("timeInSecondsToString", () => {
	it("formats sub-hour times as m:ss", () => {
		assert.equal(timeInSecondsToString(0), "0:00");
		assert.equal(timeInSecondsToString(59), "0:59");
		assert.equal(timeInSecondsToString(61), "1:01");
		assert.equal(timeInSecondsToString(3599), "59:59");
	});

	it("switches to h:mm:ss at one hour", () => {
		assert.equal(timeInSecondsToString(3600), "1:00:00");
		assert.equal(timeInSecondsToString(3661), "1:01:01");
		assert.equal(timeInSecondsToString(7325), "2:02:05");
	});

	it("pad left-fills with zeros", () => {
		assert.equal(pad(7, 2), "07");
		assert.equal(pad(70, 2), "70");
	});
});

describe("optimistic transitions", () => {
	it("play state flips between PLAYING and PAUSED", () => {
		assert.equal(togglePlayingState("PLAYING"), "PAUSED");
		assert.equal(togglePlayingState("PAUSED"), "PLAYING");
		// Anything unexpected lands on PLAYING, as the shipped ternary did.
		assert.equal(togglePlayingState("STOPPED"), "PLAYING");
	});

	it("repeat cycles NONE -> ALL -> ONE -> NONE", () => {
		assert.equal(nextRepeatState("NONE"), "ALL");
		assert.equal(nextRepeatState("ALL"), "ONE");
		assert.equal(nextRepeatState("ONE"), "NONE");
	});
});

describe("ratingShouldToggleHeart", () => {
	it("likes on a high rating only when not already liked", () => {
		assert.equal(ratingShouldToggleHeart(5, 0), true);
		assert.equal(ratingShouldToggleHeart(3, 0), true);
		assert.equal(ratingShouldToggleHeart(5, 5), false);
	});

	it("unlikes on a low rating only when currently liked", () => {
		assert.equal(ratingShouldToggleHeart(0, 5), true);
		assert.equal(ratingShouldToggleHeart(2, 5), true);
		assert.equal(ratingShouldToggleHeart(0, 0), false);
	});

	it("treats exactly 3 as the liked boundary, matching the shipped comparisons", () => {
		// currentRating 3 is NOT "liked" (> 3), so a rating of 3 toggles.
		assert.equal(ratingShouldToggleHeart(3, 3), true);
	});
});

describe("parsePositionPercentage", () => {
	it("takes the percentage after the colon", () => {
		assert.equal(parsePositionPercentage("123:45.5"), 45.5);
	});

	it("accepts a locale decimal comma", () => {
		assert.equal(parsePositionPercentage("123:45,5"), 45.5);
	});
});
