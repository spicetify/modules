/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateFloatingPosition } from "./floating-position.ts";

describe("calculateFloatingPosition", () => {
	it("places centered surfaces below their anchor when they fit", () => {
		assert.deepEqual(
			calculateFloatingPosition(
				{ left: 100, top: 100, right: 140, bottom: 120 },
				{ width: 200, height: 100 },
				{ width: 400, height: 300 },
				{ align: "center", gap: 8 },
			),
			{ left: 20, top: 128, placement: "below" },
		);
	});

	it("flips above an anchor near the bottom edge", () => {
		assert.deepEqual(
			calculateFloatingPosition(
				{ left: 80, top: 260, right: 120, bottom: 280 },
				{ width: 180, height: 120 },
				{ width: 400, height: 300 },
				{ align: "start", gap: 8 },
			),
			{ left: 80, top: 132, placement: "above" },
		);
	});

	it("clamps wide surfaces inside the viewport", () => {
		assert.deepEqual(
			calculateFloatingPosition(
				{ left: 390, top: 30, right: 410, bottom: 50 },
				{ width: 240, height: 80 },
				{ width: 400, height: 300 },
				{ align: "start", gap: 8 },
			),
			{ left: 152, top: 58, placement: "below" },
		);
	});
});
