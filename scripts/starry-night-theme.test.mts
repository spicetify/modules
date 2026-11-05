/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../modules/stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	backingSize,
	canvasScale,
	generateField,
	MAX_STARS,
	placeStar,
	type Rand,
	type Star,
	starCount,
} from "../themes/starry-night/logic.ts";

// Cycles a fixed list of draws.
function seq(...values: number[]): Rand {
	let i = 0;
	return () => values[i++ % values.length];
}

// Deterministic LCG in [0, 1).
function lcg(seed: number): Rand {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

describe("starry-night star field", () => {
	it("counts one star per 4000 px² up to the cap", () => {
		assert.equal(starCount(717, 1152), 206);
		assert.equal(starCount(3840, 1200), 1152);
		assert.equal(starCount(3840, 2160), MAX_STARS);
		assert.equal(MAX_STARS, 1500);
		assert.equal(starCount(0, 800), 0);
		assert.equal(starCount(800, 0), 0);
	});

	it("generates no stars for a zero-area viewport", () => {
		assert.equal(generateField(0, 800, Math.random).length, 0);
	});

	it("draws x, y, size, opacity, twinkle-pick, period, phase in that order", () => {
		const [low] = generateField(800, 600, seq(0, 0, 0, 0, 0, 0, 0));
		assert.deepEqual(low, { x: 0, y: 0, size: 1, opacity: 0.5, twinkle: { period: 4000, phase: 0 } });
		const [high] = generateField(800, 600, seq(0.9999));
		assert.ok(high.x < 0.99 && high.y < 0.99);
		assert.equal(high.size, 2);
		assert.ok(high.opacity < 1);
		assert.equal(high.twinkle, null);
	});

	it("keeps generated stars in range with a fifth of them twinkling", () => {
		const stars: Star[] = [];
		const rand = lcg(42);
		while (stars.length < 10_000) stars.push(...generateField(3840, 2160, rand));
		let twinkling = 0;
		for (const s of stars) {
			assert.ok(s.x >= 0 && s.x < 0.99, `x ${s.x}`);
			assert.ok(s.y >= 0 && s.y < 0.99, `y ${s.y}`);
			assert.ok(s.opacity >= 0.5 && s.opacity < 1, `opacity ${s.opacity}`);
			assert.ok(s.size === 1 || s.size === 2);
			if (s.twinkle) twinkling++;
		}
		const share = twinkling / stars.length;
		assert.ok(Math.abs(share - 0.2) <= 0.02, `twinkle share ${share}`);
	});

	it("caps the canvas scale and treats invalid ratios as 1", () => {
		assert.equal(canvasScale(1), 1);
		assert.equal(canvasScale(1.5), 1.5);
		assert.equal(canvasScale(3), 2);
		assert.equal(canvasScale(Number.NaN), 1);
		assert.equal(canvasScale(0), 1);
		assert.equal(canvasScale(-2), 1);
	});

	it("rounds backing-store sizes", () => {
		assert.deepEqual(backingSize(717, 1152, 1.25), { width: 896, height: 1440 });
	});

	it("snaps odd diameters to half pixels and even ones to whole pixels", () => {
		const rand = lcg(7);
		for (const star of generateField(717, 1152, rand)) {
			const { cx, cy, diameter } = placeStar(star, 717, 1152, 1.5);
			assert.equal(diameter, star.size === 1 ? 2 : 3);
			const frac = diameter % 2 === 1 ? 0.5 : 0;
			assert.equal(cx - Math.floor(cx), frac, `cx ${cx}`);
			assert.equal(cy - Math.floor(cy), frac, `cy ${cy}`);
			assert.ok(Math.abs(cx - star.x * 717 * 1.5) <= 1);
			assert.ok(Math.abs(cy - star.y * 1152 * 1.5) <= 1);
		}
		const tiny = placeStar({ x: 0.5, y: 0.5, size: 1, opacity: 1, twinkle: null }, 100, 100, 0.4);
		assert.equal(tiny.diameter, 1);
	});
});
