/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterBookmarks, idToProperName, isTrackUri, largestImage, withNewEntry, withoutEntry } from "./logic.ts";

describe("idToProperName", () => {
	it("dashes become spaces, each word capitalized", () => {
		assert.equal(idToProperName("my-cool-playlist"), "My Cool Playlist");
		assert.equal(idToProperName("single"), "Single");
	});
});

describe("filterBookmarks", () => {
	const items = [{ uri: "spotify:track:a" }, { uri: "spotify:episode:b" }, { uri: "spotify:playlist:c" }];

	it("0 = everything, 1 = pages only, 2 = tracks and episodes only", () => {
		assert.equal(filterBookmarks(items, 0).length, 3);
		assert.deepEqual(
			filterBookmarks(items, 1).map((i) => i.uri),
			["spotify:playlist:c"],
		);
		assert.deepEqual(
			filterBookmarks(items, 2).map((i) => i.uri),
			["spotify:track:a", "spotify:episode:b"],
		);
	});

	it("episodes count as tracks for the filter", () => {
		assert.equal(isTrackUri("spotify:episode:b"), true);
		assert.equal(isTrackUri("spotify:playlist:c"), false);
	});
});

describe("storage transforms", () => {
	it("withNewEntry prepends and stamps id as uri-timestamp without mutating", () => {
		const list = [{ id: "old", uri: "spotify:track:a" }];
		const data: { uri: string; id?: string } = { uri: "spotify:track:b" };
		const out = withNewEntry(list, data, 1234);
		assert.deepEqual(
			out.map((i) => i.id),
			["spotify:track:b-1234", "old"],
		);
		assert.equal(data.id, undefined);
		assert.equal(list.length, 1);
	});

	it("withoutEntry drops by id", () => {
		const list = [
			{ id: "a-1", uri: "spotify:track:a" },
			{ id: "b-2", uri: "spotify:track:b" },
		];
		assert.deepEqual(
			withoutEntry(list, "a-1").map((i) => i.id),
			["b-2"],
		);
	});
});

describe("largestImage", () => {
	it("picks the widest source", () => {
		const sources = [
			{ width: 64, url: "s" },
			{ width: 640, url: "l" },
			{ width: 300, url: "m" },
		];
		assert.equal(largestImage(sources).url, "l");
	});
});
