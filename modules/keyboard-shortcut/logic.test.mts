/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KEY_LIST, isOutOfView, keyLabelAt, labelPosition, rotateIndex, stepLabel } from "./logic.ts";

describe("keyLabelAt", () => {
	it("walks the qwert alphabet in second-then-first order", () => {
		assert.equal(keyLabelAt(0), "qq");
		assert.equal(keyLabelAt(1), "qw");
		assert.equal(keyLabelAt(KEY_LIST.length - 1), "qm");
		assert.equal(keyLabelAt(KEY_LIST.length), "wq");
		assert.equal(keyLabelAt(KEY_LIST.length * 2 + 2), "ee");
	});

	it("labels are unique across the practical range", () => {
		const seen = new Set(Array.from({ length: 676 }, (_, i) => keyLabelAt(i)));
		assert.equal(seen.size, 676);
	});
});

describe("stepLabel", () => {
	it("drops on mismatch, trims on match, interacts when exhausted", () => {
		assert.deepEqual(stepLabel("qw", "x"), { action: "drop" });
		assert.deepEqual(stepLabel("qw", "q"), { action: "trim", rest: "w" });
		assert.deepEqual(stepLabel("w", "w"), { action: "interact" });
	});
});

describe("isOutOfView", () => {
	const owner = { clientWidth: 1000, clientHeight: 800 };
	const base = { top: 10, bottom: 40, left: 10, right: 40, width: 30, height: 30 };

	it("visible bounds pass, offscreen or zero-size bounds fail", () => {
		assert.equal(isOutOfView(base, owner), false);
		assert.equal(isOutOfView({ ...base, top: -5 }, owner), true);
		assert.equal(isOutOfView({ ...base, bottom: 801 }, owner), true);
		assert.equal(isOutOfView({ ...base, left: 1001 }, owner), true);
		assert.equal(isOutOfView({ ...base, right: -1 }, owner), true);
		assert.equal(isOutOfView({ ...base, width: 0 }, owner), true);
	});
});

describe("labelPosition", () => {
	const bound = { top: 100, bottom: 140, left: 200, right: 260, width: 60, height: 40 };

	it("centers the 30px label except on row elements", () => {
		assert.deepEqual(labelPosition(bound, false), { top: 100 + 20 - 15, left: 200 + 30 - 15 });
		assert.deepEqual(labelPosition(bound, true), { top: 100, left: 200 });
	});
});

describe("rotateIndex", () => {
	it("wraps around both ends, including from the no-active -1 state", () => {
		assert.equal(rotateIndex(0, 1, 4), 1);
		assert.equal(rotateIndex(4, 1, 4), 0);
		assert.equal(rotateIndex(0, -1, 4), 4);
		assert.equal(rotateIndex(-1, -1, 4), 4);
		assert.equal(rotateIndex(-1, 1, 4), 0);
	});
});
