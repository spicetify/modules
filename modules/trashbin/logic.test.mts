/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectArtistUris, shouldSkipTrack, targetMatchesCurrent, toggleEntry } from "./logic.ts";

describe("collectArtistUris", () => {
	it("walks artist_uri then artist_uri:1, artist_uri:2 until a gap", () => {
		assert.deepEqual(
			collectArtistUris({
				artist_uri: "spotify:artist:a",
				"artist_uri:1": "spotify:artist:b",
				"artist_uri:3": "spotify:artist:d",
			}),
			["spotify:artist:a", "spotify:artist:b"],
		);
		assert.deepEqual(collectArtistUris({}), []);
	});
});

describe("shouldSkipTrack", () => {
	const item = { uri: "spotify:track:t", artistUris: ["spotify:artist:a", "spotify:artist:b"] };

	it("skips on a trashed song or any trashed artist on the track", () => {
		assert.equal(shouldSkipTrack(item, { "spotify:track:t": true }, {}), true);
		assert.equal(shouldSkipTrack(item, {}, { "spotify:artist:b": true }), true);
		assert.equal(shouldSkipTrack(item, {}, { "spotify:artist:x": true }), false);
		assert.equal(shouldSkipTrack(item, {}, {}), false);
	});
});

describe("targetMatchesCurrent", () => {
	const current = { uri: "spotify:track:t", artistUris: ["spotify:artist:a"] };

	it("tracks match by uri, artists match against the collected chain", () => {
		assert.equal(targetMatchesCurrent("spotify:track:t", false, current), true);
		assert.equal(targetMatchesCurrent("spotify:track:other", false, current), false);
		assert.equal(targetMatchesCurrent("spotify:artist:a", true, current), true);
		assert.equal(targetMatchesCurrent("spotify:artist:x", true, current), false);
	});
});

describe("toggleEntry", () => {
	it("adds when absent, removes when present, never mutates the input", () => {
		const list = { existing: true };
		const added = toggleEntry(list, "new");
		assert.deepEqual(added, { next: { existing: true, new: true }, added: true });
		const removed = toggleEntry(added.next, "existing");
		assert.deepEqual(removed, { next: { new: true }, added: false });
		assert.deepEqual(list, { existing: true });
	});
});
