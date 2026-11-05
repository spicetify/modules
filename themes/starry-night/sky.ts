/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The sky renderer. Every browser API comes in through SkyDeps so the
// whole controller runs under tests with fakes.

import {
	backingSize,
	canvasScale,
	dotAlpha,
	FALLBACK_COLOR,
	firstDelayMs,
	flightKeyframes,
	GLOW_BLUR,
	GLOW_SPREAD,
	generateField,
	motionState,
	placeStar,
	planFlight,
	type Rand,
	SHOOTING_STAR_COUNT,
	type Star,
	TWINKLE_FPS,
	twinkleGlow,
} from "./logic.ts";

export interface SkyColors {
	star: string;
	glow: string;
}
export interface AnimationHandle {
	play(): void;
	pause(): void;
	cancel(): void;
	onfinish: (() => void) | null;
}
export interface Viewport {
	width: number;
	height: number;
	dpr: number;
}
export interface SkyDeps {
	/** `.starrynight-bg-container`, already in the DOM. */
	container: HTMLElement;
	rand: Rand;
	viewport(): Viewport;
	getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null;
	/** For the off-DOM glow sprites. */
	createCanvas(): HTMLCanvasElement;
	requestFrame(cb: (timeMs: number) => void): number;
	cancelFrame(id: number): void;
	setTimer(fn: () => void, ms: number): number;
	clearTimer(id: number): void;
	animate(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): AnimationHandle;
	/** May return "" for a variable the palette does not define. */
	readColors(sentinel: HTMLElement): SkyColors;
}
export interface Sky {
	/** Viewport size or device pixel ratio changed. */
	resize(): void;
	setVisible(visible: boolean): void;
	setReducedMotion(reduce: boolean): void;
	/** The sentinel's color transition fired. */
	colorsChanged(): void;
	dispose(): void;
}

// After the last resize event, regenerate once more at the final size.
export const RESIZE_SETTLE_MS = 150;
const TWINKLE_INTERVAL = 1000 / TWINKLE_FPS;

interface Placed {
	star: Star;
	cx: number;
	cy: number;
	diameter: number;
	// Alpha factor so a filled square gives off the light of the round dot
	// the original theme drew (a circle covers π/4 of its square).
	light: number;
}

interface Sprite {
	canvas: HTMLCanvasElement;
	half: number;
}

function drawDot(ctx: CanvasRenderingContext2D, p: Placed, alpha: number): void {
	if (p.diameter <= 2) {
		ctx.globalAlpha = alpha * p.light;
		ctx.fillRect(p.cx - p.diameter / 2, p.cy - p.diameter / 2, p.diameter, p.diameter);
		return;
	}
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	ctx.arc(p.cx, p.cy, p.diameter / 2, 0, Math.PI * 2);
	ctx.fill();
}

/*
Pure CSS Shooting Star Animation Effect Copyright (c) 2021 by Delroy Prithvi (https://codepen.io/delroyprithvi/pen/LYyJROR)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

interface ShootingStar {
	el: HTMLElement;
	flight: AnimationHandle | null;
	firstDelay: number | null;
	// Wants to fly as soon as motion is allowed again.
	pending: boolean;
}

interface ShootingStars {
	/** Apply the current visibility, reduced motion and viewport. */
	update(): void;
	dispose(): void;
}

// Four independent stars animated with the Web Animations API, which the
// client's `animation-duration: … !important` rule cannot touch. Each
// flight ends when its tail has cleared the viewport and the next one
// starts straight from the finish handler.
function createShootingStars(deps: SkyDeps, mode: () => { visible: boolean; reducedMotion: boolean }): ShootingStars {
	let disposed = false;
	const animating = () => motionState({ ...mode(), ...deps.viewport() }) === "animating";

	const launch = (s: ShootingStar) => {
		if (disposed) return;
		if (!animating()) {
			s.pending = true;
			s.el.hidden = true;
			return;
		}
		s.pending = false;
		const { width, height } = deps.viewport();
		const { launch: at, distance, durationMs } = planFlight(width, height, deps.rand);
		s.el.style.left = `${at.x}px`;
		s.el.style.top = `${at.y}px`;
		s.el.hidden = false;
		const flight = deps.animate(s.el, flightKeyframes(distance), { duration: durationMs, easing: "linear" });
		s.flight = flight;
		flight.onfinish = () => {
			if (s.flight !== flight) return;
			s.flight = null;
			launch(s);
		};
	};

	const stars: ShootingStar[] = [];
	for (let i = 0; i < SHOOTING_STAR_COUNT; i++) {
		const el = deps.container.ownerDocument.createElement("span");
		el.className = "shootingstar";
		el.hidden = true;
		deps.container.append(el);
		const s: ShootingStar = { el, flight: null, firstDelay: null, pending: false };
		s.firstDelay = deps.setTimer(() => {
			s.firstDelay = null;
			launch(s);
		}, firstDelayMs(deps.rand));
		stars.push(s);
	}

	return {
		update() {
			if (disposed) return;
			const { visible, reducedMotion } = mode();
			for (const s of stars) {
				if (reducedMotion) {
					if (s.flight) {
						s.flight.cancel();
						s.flight = null;
						s.pending = true;
					}
					s.el.hidden = true;
				} else if (!visible) {
					s.flight?.pause();
				} else if (s.flight) {
					s.flight.play();
				} else if (s.pending) {
					launch(s);
				}
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const s of stars) {
				if (s.firstDelay !== null) deps.clearTimer(s.firstDelay);
				s.flight?.cancel();
				s.flight = null;
				s.el.remove();
			}
		},
	};
}

export function createSky(deps: SkyDeps, initial: { visible: boolean; reducedMotion: boolean }): Sky {
	const doc = deps.container.ownerDocument;
	const staticCanvas = doc.createElement("canvas");
	staticCanvas.className = "starrynight-static";
	const twinkleCanvas = doc.createElement("canvas");
	twinkleCanvas.className = "starrynight-twinkle";
	const sentinel = doc.createElement("span");
	sentinel.className = "starrynight-sentinel";
	deps.container.append(staticCanvas, twinkleCanvas, sentinel);
	const staticCtx = deps.getContext(staticCanvas);
	const twinkleCtx = deps.getContext(twinkleCanvas);

	let visible = initial.visible;
	let reducedMotion = initial.reducedMotion;
	let disposed = false;
	let frame: number | null = null;
	let settleTimer: number | null = null;

	let colors = deps.readColors(sentinel);
	let size: Viewport = { width: 0, height: 0, dpr: 1 };
	let scale = 1;
	let field: Placed[] = [];
	let twinkling: Placed[] = [];
	// Glow sprites by star size (1 or 2 CSS px).
	let sprites: Record<number, Sprite | null> = {};
	// Armed between twinkle batches. Batches are timer-driven so frames are
	// requested only when one is due: every main frame also re-services the
	// shooting stars' animations, which costs a style recalc.
	let twinkleTimer: number | null = null;
	let twinkleDue = false;

	// Work waiting for the next visible frame.
	let needsLayout = true;
	let laidOut = false;
	let needsColors = false;
	let staticDirty = false;
	let twinkleFull = false;

	const starColor = () => colors.star || FALLBACK_COLOR;
	const glowColor = () => colors.glow || FALLBACK_COLOR;

	// One sprite per star size reproduces `box-shadow: 0 0 GLOW_BLUR
	// GLOW_SPREAD` exactly: canvas shadowBlur uses the same blur model as
	// CSS. The disc is drawn off the sprite and only its shadow lands on it.
	function buildSprite(starSize: number): Sprite | null {
		const half = Math.ceil((starSize / 2 + GLOW_SPREAD + GLOW_BLUR * 1.5) * scale);
		const canvas = deps.createCanvas();
		canvas.width = canvas.height = half * 2;
		const ctx = deps.getContext(canvas);
		if (!ctx) return null;
		const offset = half * 4;
		ctx.shadowColor = glowColor();
		ctx.shadowBlur = GLOW_BLUR * scale;
		ctx.shadowOffsetX = offset;
		ctx.fillStyle = glowColor();
		ctx.beginPath();
		ctx.arc(half - offset, half, (starSize / 2 + GLOW_SPREAD) * scale, 0, Math.PI * 2);
		ctx.fill();
		return { canvas, half };
	}

	function layout(): void {
		scale = canvasScale(size.dpr);
		const backing = backingSize(size.width, size.height, scale);
		for (const canvas of [staticCanvas, twinkleCanvas]) {
			canvas.width = backing.width;
			canvas.height = backing.height;
		}
		field = generateField(size.width, size.height, deps.rand).map((star) => {
			const placed = placeStar(star, size.width, size.height, scale);
			const round = (Math.PI * (star.size * scale) ** 2) / 4;
			return { star, ...placed, light: Math.min(1, round / placed.diameter ** 2) };
		});
		twinkling = field.filter((p) => p.star.twinkle);
	}

	function drawStatic(): void {
		if (!staticCtx) return;
		staticCtx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
		staticCtx.fillStyle = starColor();
		for (const p of field) {
			if (p.star.twinkle) continue;
			drawDot(staticCtx, p, p.star.opacity);
		}
		staticCtx.globalAlpha = 1;
	}

	// Reduced motion: twinkling stars sit still at base opacity, no glow.
	function drawTwinkleStill(): void {
		if (!twinkleCtx) return;
		twinkleCtx.clearRect(0, 0, twinkleCanvas.width, twinkleCanvas.height);
		twinkleCtx.fillStyle = starColor();
		for (const p of twinkling) {
			drawDot(twinkleCtx, p, p.star.opacity);
		}
		twinkleCtx.globalAlpha = 1;
	}

	function drawTwinkleBatch(timeMs: number, full: boolean): void {
		if (!twinkleCtx) return;
		if (full) {
			twinkleCtx.clearRect(0, 0, twinkleCanvas.width, twinkleCanvas.height);
		} else {
			// Clear every glow first so a neighbor's clear never erases a
			// glow drawn earlier in this batch.
			for (const p of twinkling) {
				const half = sprites[p.star.size]?.half ?? p.diameter;
				twinkleCtx.clearRect(Math.round(p.cx - half), Math.round(p.cy - half), half * 2, half * 2);
			}
		}
		twinkleCtx.fillStyle = starColor();
		for (const p of twinkling) {
			const glow = twinkleGlow(p.star.twinkle!, timeMs);
			const sprite = sprites[p.star.size];
			if (sprite && glow > 0) {
				// The original star's opacity applied to its box-shadow too.
				twinkleCtx.globalAlpha = p.star.opacity * glow;
				twinkleCtx.drawImage(sprite.canvas, Math.round(p.cx - sprite.half), Math.round(p.cy - sprite.half));
			}
			drawDot(twinkleCtx, p, dotAlpha(p.star.opacity, glow));
		}
		twinkleCtx.globalAlpha = 1;
	}

	function onFrame(timeMs: number): void {
		frame = null;
		if (disposed || !visible) return;

		let spritesDirty = false;
		if (needsColors) {
			needsColors = false;
			colors = deps.readColors(sentinel);
			spritesDirty = staticDirty = twinkleFull = true;
		}
		if (needsLayout) {
			needsLayout = false;
			const next = deps.viewport();
			// The settle pass after a resize usually finds the size it already
			// laid out; redraw then, without reshuffling the stars a second time.
			const same = laidOut && next.width === size.width && next.height === size.height && next.dpr === size.dpr;
			size = next;
			if (!same) layout();
			laidOut = true;
			spritesDirty = staticDirty = twinkleFull = true;
		}
		if (spritesDirty) sprites = { 1: buildSprite(1), 2: buildSprite(2) };
		if (staticDirty) {
			staticDirty = false;
			drawStatic();
		}

		const state = motionState({ visible, reducedMotion, width: size.width, height: size.height });
		if (state === "static") {
			if (twinkleFull) drawTwinkleStill();
			twinkleFull = false;
			stopTwinkle();
		} else if (state === "animating") {
			// A batch runs when the timer says so, when something forced a
			// full redraw, or on resume (no timer armed). Each batch restarts
			// the timer, so batches stay at least TWINKLE_INTERVAL apart and a
			// long gap never causes a catch-up burst.
			if (twinkleDue || twinkleFull || twinkleTimer === null) {
				drawTwinkleBatch(timeMs, twinkleFull);
				twinkleDue = twinkleFull = false;
				stopTwinkle();
				twinkleTimer = deps.setTimer(() => {
					twinkleTimer = null;
					twinkleDue = true;
					schedule();
				}, TWINKLE_INTERVAL);
			}
		} else {
			stopTwinkle();
		}
	}

	function stopTwinkle(): void {
		if (twinkleTimer === null) return;
		deps.clearTimer(twinkleTimer);
		twinkleTimer = null;
	}

	function schedule(): void {
		if (disposed || !visible || frame !== null) return;
		frame = deps.requestFrame(onFrame);
	}

	function cancelFrame(): void {
		if (frame === null) return;
		deps.cancelFrame(frame);
		frame = null;
	}

	const shooting = createShootingStars(deps, () => ({ visible, reducedMotion }));
	schedule();

	return {
		resize() {
			if (disposed) return;
			needsLayout = true;
			if (settleTimer !== null) deps.clearTimer(settleTimer);
			settleTimer = deps.setTimer(() => {
				settleTimer = null;
				needsLayout = true;
				schedule();
			}, RESIZE_SETTLE_MS);
			schedule();
			shooting.update();
		},
		setVisible(next) {
			if (disposed) return;
			visible = next;
			if (visible) schedule();
			else {
				cancelFrame();
				stopTwinkle();
			}
			shooting.update();
		},
		setReducedMotion(reduce) {
			if (disposed || reduce === reducedMotion) return;
			reducedMotion = reduce;
			twinkleFull = true;
			schedule();
			shooting.update();
		},
		colorsChanged() {
			if (disposed) return;
			needsColors = true;
			schedule();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			cancelFrame();
			stopTwinkle();
			if (settleTimer !== null) deps.clearTimer(settleTimer);
			settleTimer = null;
			shooting.dispose();
			staticCanvas.remove();
			twinkleCanvas.remove();
			sentinel.remove();
		},
	};
}
