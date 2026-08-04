/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSkippableVideo } from "./logic.ts";

describe("isSkippableVideo", () => {
	it("skips video media", () => {
		assert.equal(isSkippableVideo({ metadata: { "media.type": "video" } }), true);
	});

	it("never skips ads, which also play as video", () => {
		assert.equal(isSkippableVideo({ metadata: { "media.type": "video", is_advertisement: "true" } }), false);
	});

	it("leaves audio and missing data alone", () => {
		assert.equal(isSkippableVideo({ metadata: { "media.type": "audio" } }), false);
		assert.equal(isSkippableVideo(undefined), false);
	});
});
