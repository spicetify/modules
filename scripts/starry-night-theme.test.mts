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
	dotAlpha,
	generateField,
	MAX_STARS,
	placeStar,
	type Rand,
	type Star,
	starCount,
	TWINKLE_DOT_MIN,
	twinkleEnvelope,
	twinkleGlow,
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

describe("starry-night twinkle", () => {
	it("holds full glow for the first fifth and none from 40% to 80%", () => {
		for (const u of [0, 0.1, 0.199]) assert.equal(twinkleEnvelope(u), 1, `u ${u}`);
		for (const u of [0.4, 0.6, 0.799]) assert.equal(twinkleEnvelope(u), 0, `u ${u}`);
	});

	it("fades out and back in monotonically", () => {
		const samples = (from: number, to: number) =>
			Array.from({ length: 21 }, (_, i) => twinkleEnvelope(from + ((to - from) * (i + 1)) / 22));
		const out = samples(0.2, 0.4);
		const back = samples(0.8, 1);
		for (let i = 1; i < 21; i++) {
			assert.ok(out[i] < out[i - 1], `fade out at ${i}`);
			assert.ok(back[i] > back[i - 1], `fade in at ${i}`);
		}
	});

	it("eases the fades instead of ramping linearly", () => {
		assert.ok(Math.abs(twinkleEnvelope(0.25) - 0.75) > 0.05);
	});

	it("is continuous at the wraparound and reduces any input mod 1", () => {
		assert.ok(Math.abs(twinkleEnvelope(0.99999) - twinkleEnvelope(0)) < 1e-3);
		assert.equal(twinkleEnvelope(1.1), twinkleEnvelope(0.1));
		assert.ok(Math.abs(twinkleEnvelope(-0.7) - twinkleEnvelope(0.3)) < 1e-9);
	});

	it("dims the dot to TWINKLE_DOT_MIN of its base opacity at zero glow", () => {
		assert.equal(dotAlpha(0.8, 1), 0.8);
		assert.ok(Math.abs(dotAlpha(0.8, 0) - 0.8 * TWINKLE_DOT_MIN) < 1e-9);
	});

	it("evaluates glow from the star's own period and phase at any time", () => {
		const glow = twinkleGlow({ period: 5000, phase: 1000 }, 3_600_000);
		assert.ok(glow >= 0 && glow <= 1);
		assert.equal(glow, twinkleEnvelope(((3_600_000 + 1000) % 5000) / 5000));
	});

	it("takes separate draws for each twinkling star's period and phase", () => {
		const counting = (value: number) => {
			let draws = 0;
			const rand: Rand = () => {
				draws++;
				return value;
			};
			return { rand, draws: () => draws };
		};
		// 80 × 50 px is exactly one star.
		const plain = counting(0.9);
		assert.equal(generateField(80, 50, plain.rand)[0].twinkle, null);
		const twinkling = counting(0.1);
		const [star] = generateField(80, 50, twinkling.rand);
		assert.ok(star.twinkle);
		assert.equal(twinkling.draws() - plain.draws(), 2);
		assert.ok(star.twinkle.period >= 4000 && star.twinkle.period <= 6000);
		assert.ok(star.twinkle.phase >= 0 && star.twinkle.phase < star.twinkle.period);
	});
});
