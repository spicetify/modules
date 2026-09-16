import assert from "node:assert/strict";
import { test } from "node:test";
import { vibrantColor, trackTempo, tokenResponse } from "./cosmos-responses.ts";

test("missing and malformed Spotify cosmetics use usable defaults", () => {
	for (const value of [null, [], {}, { entries: [{}] }, { tempo: NaN }, { tempo: "120" }]) {
		assert.equal(vibrantColor(value), 8747370);
		assert.equal(trackTempo(value), 105);
	}
	assert.equal(vibrantColor({ entries: [{ color_swatches: [{ preset: "VIBRANT_NON_ALARMING", color: 12 }] }] }), 12);
	assert.equal(trackTempo({ tempo: 120 }), 120);
});

test("token responses validate status and reject unusable credentials", () => {
	assert.deepEqual(tokenResponse(null), { status: 0, token: undefined });
	assert.deepEqual(tokenResponse({ message: { header: { status_code: 401 } } }), { status: 401, token: undefined });
	assert.deepEqual(tokenResponse({ message: { header: { status_code: 200 }, body: { user_token: "valid" } } }), {
		status: 200,
		token: "valid",
	});
	assert.equal(tokenResponse({ message: { body: { user_token: "UpgradeOnly-test" } } }).token, undefined);
});
