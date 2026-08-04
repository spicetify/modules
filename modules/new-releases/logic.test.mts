/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	DAY_MS,
	type Release,
	artUrl,
	dedupeAndSort,
	filterVisible,
	groupByDay,
	largestCover,
	mapPool,
	typeLabel,
	validateCache,
} from "./logic.ts";

const release = (uri: string, time: number, type = "Album"): Release => ({
	uri,
	title: uri,
	artist: { name: "a", uri: "spotify:artist:a" },
	imageUrl: "",
	time,
	type,
	trackCount: 10,
});

describe("artUrl / largestCover", () => {
	it("maps spotify:image: uris to scdn urls and passes through the rest", () => {
		assert.equal(artUrl("spotify:image:abc"), "https://i.scdn.co/image/abc");
		assert.equal(artUrl("https://x/y.jpg"), "https://x/y.jpg");
		assert.equal(artUrl(undefined), "");
	});

	it("largestCover picks the widest source", () => {
		assert.equal(
			largestCover([
				{ url: "spotify:image:s", width: 64 },
				{ url: "spotify:image:l", width: 640 },
			]),
			"https://i.scdn.co/image/l",
		);
		assert.equal(largestCover([]), "");
		assert.equal(largestCover(undefined), "");
	});
});

describe("typeLabel", () => {
	it("maps GraphQL release types to the three chips, dropping unknowns", () => {
		assert.equal(typeLabel("ALBUM"), "Album");
		assert.equal(typeLabel("SINGLE"), "Single/EP");
		assert.equal(typeLabel("EP"), "Single/EP");
		assert.equal(typeLabel("COMPILATION"), "Compilation");
		assert.equal(typeLabel("PODCAST"), null);
	});
});

describe("mapPool", () => {
	it("runs everything with bounded concurrency and flattens results", async () => {
		let active = 0;
		let peak = 0;
		const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 5));
			active--;
			return [n * 10];
		});
		assert.deepEqual(
			out.toSorted((a, b) => a - b),
			[10, 20, 30, 40, 50],
		);
		assert.ok(peak <= 2, `peak concurrency ${peak}`);
	});

	it("a throwing item is skipped, the rest survive", async () => {
		const out = await mapPool([1, 2, 3], 3, async (n) => {
			if (n === 2) throw new Error("boom");
			return [n];
		});
		assert.deepEqual(
			out.toSorted((a, b) => a - b),
			[1, 3],
		);
	});
});

describe("dedupeAndSort", () => {
	it("keeps the first occurrence per uri and sorts newest first", () => {
		const out = dedupeAndSort([release("a", 100), release("b", 300), release("a", 999), release("c", 200)]);
		assert.deepEqual(
			out.map((r) => [r.uri, r.time]),
			[
				["b", 300],
				["c", 200],
				["a", 100],
			],
		);
	});
});

describe("filterVisible", () => {
	const now = 1000 * DAY_MS;
	const cfg = { range: 30, album: true, singleEp: false, compilations: false };
	const items = [
		release("in-range-album", now - 10 * DAY_MS, "Album"),
		release("in-range-single", now - 10 * DAY_MS, "Single/EP"),
		release("too-old", now - 40 * DAY_MS, "Album"),
		release("dismissed", now - 5 * DAY_MS, "Album"),
	];

	it("applies range, type chips and the dismissed set", () => {
		const out = filterVisible(items, cfg, new Set(["dismissed"]), now);
		assert.deepEqual(
			out.map((r) => r.uri),
			["in-range-album"],
		);
		const withSingles = filterVisible(items, { ...cfg, singleEp: true }, new Set(), now);
		assert.deepEqual(
			withSingles.map((r) => r.uri),
			["in-range-album", "in-range-single", "dismissed"],
		);
	});
});

describe("validateCache", () => {
	it("accepts the current shape and rejects null, old versions and junk", () => {
		const good = { v: 1, fetchedAt: 5, releases: [] };
		assert.equal(validateCache(good, 1), good);
		assert.equal(validateCache(null, 1), null);
		assert.equal(validateCache({ v: 0, fetchedAt: 5, releases: [] }, 1), null);
		assert.equal(validateCache({ v: 1, fetchedAt: 5, releases: "nope" }, 1), null);
	});
});

describe("groupByDay", () => {
	// Fixed "now" at a day boundary keeps labels deterministic.
	const now = Date.UTC(2026, 7, 4, 12);
	const today = release("t1", now - 3600_000);
	const yesterday = release("y1", now - DAY_MS);
	const yesterday2 = release("y2", now - DAY_MS - 3600_000);

	it("adjacent same-label releases share a group, in feed order", () => {
		const groups = groupByDay([today, yesterday, yesterday2], true, "en-US", now);
		assert.deepEqual(
			groups.map((g) => [g.label, g.items.length]),
			[
				["today", 1],
				["yesterday", 2],
			],
		);
	});

	it("absolute mode uses the locale date format", () => {
		const groups = groupByDay([today], false, "en-US", now);
		assert.equal(
			groups[0].label,
			new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "2-digit" }).format(
				now - 3600_000,
			),
		);
	});
});
