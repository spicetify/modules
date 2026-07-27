/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Validates the DOM test harness itself: happy-dom globals are installed
// and behave, so kit tests (ui.test.mts) can trust document/events.

import "./test-setup.mts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("dom test harness", () => {
	it("installs a working document", () => {
		const node = document.createElement("div");
		node.className = "x";
		assert.equal(node.tagName, "DIV");
		assert.equal(node.className, "x");
	});

	it("dispatches events to listeners", () => {
		const button = document.createElement("button");
		let clicks = 0;
		button.addEventListener("click", () => clicks++);
		button.dispatchEvent(new MouseEvent("click"));
		assert.equal(clicks, 1);
	});
});
