/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	EPSILON,
	findActiveZone,
	moveEnd,
	moveStart,
	moveZoneEdge,
	parseStoredState,
	restartThresholds,
} from "./logic.ts";

describe("marker clamping", () => {
	it("start clamps to 0 and stays epsilon before end", () => {
		assert.equal(moveStart(0.5, null, -1), 0);
		assert.equal(moveStart(0.5, null, 1), 1);
		assert.equal(moveStart(0.5, 0.6, 0.5), 0.6 - EPSILON);
	});

	it("end clamps to 1 and stays epsilon after start", () => {
		assert.equal(moveEnd(0.5, null, 1), 1);
		assert.equal(moveEnd(0.5, null, -1), 0);
		assert.equal(moveEnd(0.5, 0.4, -0.5), 0.4 + EPSILON);
	});

	it("zone edges clamp against each other without mutating the input", () => {
		const zone = { start: 0.2, end: 0.4 };
		assert.deepEqual(moveZoneEdge(zone, "start", 0.5), { start: 0.4 - EPSILON, end: 0.4 });
		assert.deepEqual(moveZoneEdge(zone, "end", -0.5), { start: 0.2, end: 0.2 + EPSILON });
		assert.deepEqual(zone, { start: 0.2, end: 0.4 });
	});
});

describe("parseStoredState", () => {
	it("round-trips a saved state and defaults missing fields", () => {
		assert.deepEqual(
			parseStoredState(JSON.stringify({ start: 0.1, end: 0.9, skipZones: [{ start: 0.4, end: 0.5 }] })),
			{
				start: 0.1,
				end: 0.9,
				skipZones: [{ start: 0.4, end: 0.5 }],
			},
		);
		assert.deepEqual(parseStoredState(JSON.stringify({})), { start: null, end: null, skipZones: [] });
	});

	it("null and corrupt payloads yield the empty state", () => {
		assert.deepEqual(parseStoredState(null), { start: null, end: null, skipZones: [] });
		assert.deepEqual(parseStoredState("{oops"), { start: null, end: null, skipZones: [] });
		assert.deepEqual(parseStoredState(JSON.stringify({ skipZones: "nope" })).skipZones, []);
	});
});

describe("findActiveZone", () => {
	const zones = [
		{ start: 0.1, end: 0.2 },
		{ start: 0.5, end: 0.6 },
	];

	it("start-inclusive, end-exclusive", () => {
		assert.equal(findActiveZone(zones, 0.15), 0);
		assert.equal(findActiveZone(zones, 0.5), 1);
		assert.equal(findActiveZone(zones, 0.6), -1);
		assert.equal(findActiveZone(zones, 0.3), -1);
	});
});

describe("restartThresholds", () => {
	it("scales the 3s/1.5s windows by duration with unknown-duration fallbacks", () => {
		assert.deepEqual(restartThresholds(180000), { threeSecFrac: 3000 / 180000, nearZeroFrac: 1500 / 180000 });
		assert.deepEqual(restartThresholds(0), { threeSecFrac: 0.02, nearZeroFrac: 0.01 });
	});
});
