/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	collectArtistUris,
	matchingEntries,
	normalizeList,
	shouldSkipTrack,
	targetMatchesCurrent,
	toggleEntry,
	trackLabel,
	trashedEntries,
} from "./logic.ts";

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

describe("normalizeList", () => {
	it("keeps every truthy entry as true and drops everything else", () => {
		assert.deepEqual(normalizeList({ a: true, b: "Artist - Song", c: false, d: null, e: "" }), {
			a: true,
			b: true,
		});
	});

	it("treats anything that is not a plain object as an empty list", () => {
		for (const value of [null, undefined, "text", 3, ["spotify:track:t"]]) {
			assert.deepEqual(normalizeList(value), {});
		}
	});
});

describe("trackLabel", () => {
	it("puts the artists before the title", () => {
		assert.equal(trackLabel("Song", ["A", "B"]), "A, B - Song");
		assert.equal(trackLabel("Song", []), "Song");
	});
});

describe("trashedEntries", () => {
	it("lists songs then artists, each newest first", () => {
		assert.deepEqual(trashedEntries({ s1: true, s2: true }, { a1: true }), [
			{ uri: "s2", kind: "song" },
			{ uri: "s1", kind: "song" },
			{ uri: "a1", kind: "artist" },
		]);
	});
});

describe("matchingEntries", () => {
	const entries = trashedEntries({ "spotify:track:1": true, "spotify:track:2": true }, { "spotify:artist:3": true });
	const labels = new Map([
		["spotify:track:1", "Rick Astley - Never Gonna Give You Up"],
		["spotify:artist:3", "Rick Astley"],
	]);
	const uris = (query: string) => matchingEntries(entries, (uri) => labels.get(uri), query).map((e) => e.uri);

	it("matches names case-insensitively and ignores surrounding spaces", () => {
		assert.deepEqual(uris("  rick "), ["spotify:track:1", "spotify:artist:3"]);
		assert.deepEqual(uris("never gonna"), ["spotify:track:1"]);
	});

	it("matches an unnamed entry by its uri, and an empty query keeps everything", () => {
		assert.deepEqual(uris("track:2"), ["spotify:track:2"]);
		assert.equal(uris("").length, 3);
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
