/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	clampMenuPosition,
	filterBookmarks,
	idToProperName,
	isTrackUri,
	largestImage,
	withNewEntry,
	withoutEntry,
} from "./logic.ts";

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

describe("clampMenuPosition", () => {
	const menu = { width: 360, height: 400 };
	const viewport = { width: 1440, height: 900 };

	it("keeps the y+40 drop and clamps into the viewport with an 8px margin", () => {
		assert.deepEqual(clampMenuPosition(100, 50, menu, viewport), { left: 100, top: 90 });
		// A right-edge topbar button would push the menu off-screen: clamp.
		assert.deepEqual(clampMenuPosition(1400, 50, menu, viewport), { left: 1440 - 360 - 8, top: 90 });
		assert.deepEqual(clampMenuPosition(100, 880, menu, viewport), { left: 100, top: 900 - 400 - 8 });
		assert.deepEqual(clampMenuPosition(-50, -100, menu, viewport), { left: 8, top: 8 });
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
