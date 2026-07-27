/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { badgeClass, buttonClass, chipClass } from "./ui-classes.ts";

describe("chrome class contract", () => {
	it("maps button variants", () => {
		assert.equal(buttonClass(), "spicetify-button");
		assert.equal(buttonClass("primary"), "spicetify-button");
		assert.equal(buttonClass("secondary"), "spicetify-button spicetify-button--secondary");
		assert.equal(buttonClass("danger"), "spicetify-button spicetify-button--danger");
	});

	it("maps badge tones", () => {
		assert.equal(badgeClass(), "spicetify-badge");
		assert.equal(badgeClass("neutral"), "spicetify-badge");
		assert.equal(badgeClass("ok"), "spicetify-badge spicetify-badge--ok");
		assert.equal(badgeClass("bad"), "spicetify-badge spicetify-badge--bad");
	});

	it("maps chip active state", () => {
		assert.equal(chipClass(false), "spicetify-chip");
		assert.equal(chipClass(true), "spicetify-chip spicetify-chip--active");
	});
});
