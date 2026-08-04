/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildNextTracks, matchesArtistFilter, parseStoredConfig, searchFolder, shuffle } from "./logic.ts";

describe("shuffle", () => {
	it("returns a permutation of the input", () => {
		const input = Array.from({ length: 50 }, (_, i) => `spotify:track:${i}`);
		const out = shuffle([...input]);
		assert.equal(out.length, 50);
		assert.deepEqual([...out].sort(), [...input].sort());
	});

	it("returns short arrays untouched", () => {
		assert.deepEqual(shuffle([]), []);
		assert.deepEqual(shuffle(["only"]), ["only"]);
	});

	it("mutates its input, as shipped", () => {
		const input = Array.from({ length: 20 }, (_, i) => `t${i}`);
		const copy = [...input];
		shuffle(input);
		// Pinning the in-place behaviour: callers rely on passing throwaway
		// arrays, and a "fix" here would double memory on huge libraries.
		assert.notDeepEqual(input, copy);
	});

	it("drops falsy entries, as shipped", () => {
		const out = shuffle(["a", "", "b", null as unknown as string, "c"]);
		assert.deepEqual([...out].sort(), ["a", "b", "c"]);
	});

	it("actually reorders large inputs", () => {
		const input = Array.from({ length: 100 }, (_, i) => `t${i}`);
		// One permutation of 100 items matching identity is ~1/100! - if this
		// ever fails, shuffle stopped shuffling.
		assert.notDeepEqual(shuffle([...input]), input);
	});
});

describe("searchFolder", () => {
	const tree = [
		{ type: "playlist", uri: "p1" },
		{
			type: "folder",
			uri: "f1",
			items: [
				{ type: "playlist", uri: "p2" },
				{ type: "folder", uri: "f2", items: [{ type: "playlist", uri: "p3" }] },
			],
		},
	];

	it("finds a top-level folder", () => {
		assert.equal(searchFolder(tree, "f1")?.uri, "f1");
	});

	it("finds a nested folder depth-first", () => {
		assert.equal(searchFolder(tree, "f2")?.uri, "f2");
	});

	it("returns undefined for a playlist uri or a miss", () => {
		assert.equal(searchFolder(tree, "p1"), undefined);
		assert.equal(searchFolder(tree, "nope"), undefined);
	});

	it("skips folder rows without items rather than throwing", () => {
		assert.equal(searchFolder([{ type: "folder", uri: "f3" }], "f3"), undefined);
	});
});

describe("parseStoredConfig", () => {
	it("returns the parsed settings object", () => {
		assert.deepEqual(parseStoredConfig('{"artistMode":"liked"}'), { artistMode: "liked" });
	});

	it("returns an empty stored object as-is - defaults only apply on parse failure", () => {
		// Pinned quirk: "{}" is valid, so every field stays undefined.
		assert.deepEqual(parseStoredConfig("{}"), {});
	});

	it("returns null for absent, malformed, or non-object blobs", () => {
		assert.equal(parseStoredConfig(null), null);
		assert.equal(parseStoredConfig("{not json"), null);
		assert.equal(parseStoredConfig('"a string"'), null);
		assert.equal(parseStoredConfig("42"), null);
	});
});

describe("matchesArtistFilter", () => {
	const track = { artists: { items: [{ profile: { name: "Mitski" } }, { profile: { name: "Feature" } }] } };

	it("passes everything when artistNameMust is off", () => {
		assert.equal(matchesArtistFilter(track, "Someone Else", false), true);
	});

	it("requires an exact credited-artist match when on", () => {
		assert.equal(matchesArtistFilter(track, "Mitski", true), true);
		assert.equal(matchesArtistFilter(track, "mitski", true), false);
		assert.equal(matchesArtistFilter(track, "Someone Else", true), false);
	});
});

describe("buildNextTracks", () => {
	it("shapes uris into setQueue context tracks", () => {
		const [t] = buildNextTracks(["spotify:track:x"]);
		assert.deepEqual(t, {
			contextTrack: { uri: "spotify:track:x", uid: "", metadata: { is_queued: "false" } },
			removed: [],
			blocked: [],
			provider: "context",
		});
	});

	it("preserves order and length", () => {
		const out = buildNextTracks(["a", "b", "spotify:delimiter"]);
		assert.deepEqual(
			out.map((t) => t.contextTrack.uri),
			["a", "b", "spotify:delimiter"],
		);
	});
});
