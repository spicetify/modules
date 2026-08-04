/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isExplicit } from "./logic.ts";

describe("isExplicit", () => {
	it("reads the string flag on track metadata", () => {
		assert.equal(isExplicit({ metadata: { is_explicit: "true" } }), true);
		assert.equal(isExplicit({ metadata: { is_explicit: "false" } }), false);
	});

	it("falls back to the boolean queue-item flag", () => {
		assert.equal(isExplicit({ isExplicit: true }), true);
		assert.equal(isExplicit({ isExplicit: false }), false);
	});

	it("prefers metadata over the fallback when both exist", () => {
		assert.equal(isExplicit({ metadata: { is_explicit: "false" }, isExplicit: true }), false);
	});

	it("treats missing data as not explicit", () => {
		assert.equal(isExplicit(undefined), false);
		assert.equal(isExplicit({}), false);
	});
});
