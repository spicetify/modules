/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldHide } from "./logic.ts";

test("shouldHide defaults on and stays off only for an explicit opt-out", () => {
	assert.equal(shouldHide("1"), true);
	assert.equal(shouldHide("0"), false);
	assert.equal(shouldHide(null), true);
});
