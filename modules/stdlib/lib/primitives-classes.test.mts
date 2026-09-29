/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as chromeClasses from "./primitives-classes.ts";
import { badgeClass, buttonClass, chipClass } from "./primitives-classes.ts";

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

	it("matches Spotify's keyboard activation contract", () => {
		const activateToggleOnKeyDown = (chromeClasses as Record<string, unknown>).activateToggleOnKeyDown;
		let clicks = 0;
		let prevented = 0;
		let stopped = 0;
		const event = (key: string) => ({
			key,
			currentTarget: { click: () => clicks++ },
			preventDefault: () => prevented++,
			stopPropagation: () => stopped++,
		});

		(activateToggleOnKeyDown as (input: ReturnType<typeof event>) => void)(event("Escape"));
		assert.deepEqual({ clicks, prevented, stopped }, { clicks: 0, prevented: 0, stopped: 0 });

		(activateToggleOnKeyDown as (input: ReturnType<typeof event>) => void)(event(" "));
		assert.deepEqual({ clicks, prevented, stopped }, { clicks: 1, prevented: 1, stopped: 1 });

		(activateToggleOnKeyDown as (input: ReturnType<typeof event>) => void)(event("Enter"));
		assert.deepEqual({ clicks, prevented, stopped }, { clicks: 2, prevented: 2, stopped: 2 });
	});
});
