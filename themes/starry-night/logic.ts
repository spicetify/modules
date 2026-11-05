/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Pure sky math: no DOM, no globals. Everything random takes an injected
// source so tests can seed it.

// One star per this much viewport area (CSS px²), capped for huge windows.
export const STAR_AREA_PER_STAR = 4000;
export const MAX_STARS = 1500;
export const TWINKLE_CHANCE = 1 / 5;
export const TWINKLE_PERIOD_MIN = 4000;
export const TWINKLE_PERIOD_MAX = 6000;
// Twinkle redraws per second, and how far a twinkling dot dims (as a share
// of its base opacity) while its glow is off.
export const TWINKLE_FPS = 24;
export const TWINKLE_DOT_MIN = 0.7;
export const MAX_CANVAS_DPR = 2;
export const SHOOTING_STAR_COUNT = 4;
export const SHOOTING_SPEED_MIN = 250;
export const SHOOTING_SPEED_MAX = 500;
export const SHOOTING_TAIL = 300;
export const GLOW_BLUR = 8;
export const GLOW_SPREAD = 2;
export const FALLBACK_COLOR = "#FFFFFF";

/** Uniform in [0, 1). */
export type Rand = () => number;
/** Period in ms; phase in [0, period). */
export interface Twinkle {
	period: number;
	phase: number;
}
/** x and y are fractions of the viewport in [0, 0.99). */
export interface Star {
	x: number;
	y: number;
	size: 1 | 2;
	opacity: number;
	twinkle: Twinkle | null;
}

export function starCount(width: number, height: number): number {
	if (!(width > 0) || !(height > 0)) return 0;
	return Math.min(Math.floor((width * height) / STAR_AREA_PER_STAR), MAX_STARS);
}

// Draw order per star: x, y, size, opacity, twinkle-pick, then period and
// phase only for twinkling stars.
export function generateField(width: number, height: number, rand: Rand): Star[] {
	const count = starCount(width, height);
	const stars: Star[] = [];
	for (let i = 0; i < count; i++) {
		const x = rand() * 0.99;
		const y = rand() * 0.99;
		const size = rand() < 0.5 ? 1 : 2;
		const opacity = 0.5 + rand() * 0.5;
		let twinkle: Twinkle | null = null;
		if (rand() < TWINKLE_CHANCE) {
			const period = TWINKLE_PERIOD_MIN + rand() * (TWINKLE_PERIOD_MAX - TWINKLE_PERIOD_MIN);
			twinkle = { period, phase: rand() * period };
		}
		stars.push({ x, y, size, opacity, twinkle });
	}
	return stars;
}

export function canvasScale(dpr: number): number {
	if (!Number.isFinite(dpr) || dpr <= 0) return 1;
	return Math.min(dpr, MAX_CANVAS_DPR);
}

export function backingSize(cssWidth: number, cssHeight: number, scale: number): { width: number; height: number } {
	return { width: Math.round(cssWidth * scale), height: Math.round(cssHeight * scale) };
}

// Smoothstep: eased, monotonic on [0, 1].
const ease = (t: number) => t * t * (3 - 2 * t);

// Glow over one cycle, u reduced mod 1: full for 20%, eased fade out for
// 20%, off for 40%, eased fade in for 20%. Matches the original keyframes.
export function twinkleEnvelope(u: number): number {
	const p = u - Math.floor(u);
	if (p < 0.2) return 1;
	if (p < 0.4) return 1 - ease((p - 0.2) / 0.2);
	if (p < 0.8) return 0;
	return ease((p - 0.8) / 0.2);
}

export function twinkleGlow(twinkle: Twinkle, timeMs: number): number {
	return twinkleEnvelope(
		((((timeMs + twinkle.phase) % twinkle.period) + twinkle.period) % twinkle.period) / twinkle.period,
	);
}

export function dotAlpha(baseOpacity: number, glow: number): number {
	return baseOpacity * (TWINKLE_DOT_MIN + (1 - TWINKLE_DOT_MIN) * glow);
}

// An odd diameter centers on a half pixel and an even one on a whole pixel,
// so the dot covers whole backing pixels and stays crisp at fractional DPR.
const snap = (value: number, diameter: number) => (diameter % 2 === 1 ? Math.floor(value) + 0.5 : Math.round(value));

/** Center and diameter in backing pixels. */
export function placeStar(
	star: Star,
	cssWidth: number,
	cssHeight: number,
	scale: number,
): { cx: number; cy: number; diameter: number } {
	const diameter = Math.max(1, Math.round(star.size * scale));
	return {
		cx: snap(star.x * cssWidth * scale, diameter),
		cy: snap(star.y * cssHeight * scale, diameter),
		diameter,
	};
}
