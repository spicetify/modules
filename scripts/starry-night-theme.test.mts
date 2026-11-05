/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../modules/stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	backingSize,
	FALLBACK_COLOR,
	canvasScale,
	dotAlpha,
	firstDelayMs,
	flightDistance,
	flightKeyframes,
	generateField,
	MAX_STARS,
	motionState,
	pickLaunch,
	placeStar,
	planFlight,
	type Rand,
	type Star,
	starCount,
	TWINKLE_DOT_MIN,
	TWINKLE_FPS,
	twinkleEnvelope,
	twinkleGlow,
} from "../themes/starry-night/logic.ts";
import {
	type AnimationHandle,
	createSky,
	RESIZE_SETTLE_MS,
	type SkyColors,
	type SkyDeps,
	type Viewport,
} from "../themes/starry-night/sky.ts";

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

describe("starry-night shooting stars", () => {
	it("launches from above the top edge or past the right edge", () => {
		// The top-edge offset draw is scaled to 0–90% of the width.
		const top = pickLaunch(800, 600, seq(0.5, 0.5 / 0.9));
		assert.ok(Math.abs(top.x - 400) < 1e-9);
		assert.equal(top.y, -4);
		assert.deepEqual(pickLaunch(800, 600, seq(0.75, 0.5)), { x: 804, y: 150 });
	});

	it("splits launches 75/25 within the original ranges", () => {
		const rand = lcg(11);
		let topCount = 0;
		for (let i = 0; i < 1000; i++) {
			const l = pickLaunch(800, 600, rand);
			if (l.y === -4) {
				topCount++;
				assert.ok(l.x >= 80 && l.x <= 800, `top x ${l.x}`);
			} else {
				assert.equal(l.x, 804);
				assert.ok(l.y >= 0 && l.y <= 300, `right y ${l.y}`);
			}
		}
		assert.ok(Math.abs(topCount / 1000 - 0.75) <= 0.04, `top share ${topCount / 1000}`);
	});

	it("flies until the head leaves the viewport, plus the tail", () => {
		const expected = Math.min(400 * Math.SQRT2, (1152 + 4) * Math.SQRT2) + 300;
		assert.ok(Math.abs(flightDistance({ x: 400, y: -4 }, 717, 1152) - expected) < 1e-9);
	});

	it("puts the head on the left or bottom edge exactly when the tail starts clearing", () => {
		const rand = lcg(5);
		for (const [w, h] of [
			[717, 1152],
			[3840, 1200],
			[800, 600],
		]) {
			for (let i = 0; i < 200; i++) {
				const launch = pickLaunch(w, h, rand);
				const d = flightDistance(launch, w, h) - 300;
				const at = (k: number) => ({ x: launch.x - k / Math.SQRT2, y: launch.y + k / Math.SQRT2 });
				const end = at(d);
				assert.ok(Math.abs(end.x) < 1e-6 || Math.abs(end.y - h) < 1e-6, `end ${end.x},${end.y}`);
				const before = at(d * 0.99);
				assert.ok(before.x > 0 && before.y < h);
			}
		}
	});

	it("derives the duration from a speed in [250, 500] px/s", () => {
		const slow = planFlight(800, 600, seq(0.1, 0.5, 0));
		assert.equal(slow.durationMs, (slow.distance / 250) * 1000);
		const fast = planFlight(800, 600, seq(0.1, 0.5, 1 - 1e-12));
		assert.ok(Math.abs(fast.durationMs - (fast.distance / 500) * 1000) < 1e-6);
		assert.equal(slow.distance, flightDistance(slow.launch, 800, 600));
	});

	it("delays only by whole seconds from 0 to 6", () => {
		assert.equal(firstDelayMs(seq(0)), 0);
		assert.equal(firstDelayMs(seq(0.999)), 6000);
		const rand = lcg(3);
		for (let i = 0; i < 100; i++) assert.equal(firstDelayMs(rand) % 1000, 0);
	});

	it("keeps the original rotation and opacity shape", () => {
		assert.deepEqual(flightKeyframes(1000), [
			{ transform: "rotate(315deg) translateX(0)", opacity: 1, offset: 0 },
			{ opacity: 1, offset: 0.7 },
			{ transform: "rotate(315deg) translateX(-1000px)", opacity: 0, offset: 1 },
		]);
	});
});

describe("starry-night motion state", () => {
	it("suspends when hidden or empty, else goes static under reduced motion", () => {
		const cases: [boolean, boolean, boolean, string][] = [
			// visible, reducedMotion, zeroArea, expected
			[true, false, false, "animating"],
			[true, true, false, "static"],
			[true, false, true, "suspended"],
			[true, true, true, "suspended"],
			[false, false, false, "suspended"],
			[false, true, false, "suspended"],
			[false, false, true, "suspended"],
			[false, true, true, "suspended"],
		];
		for (const [visible, reducedMotion, zero, expected] of cases) {
			const size = zero ? { width: 0, height: 600 } : { width: 800, height: 600 };
			assert.equal(
				motionState({ visible, reducedMotion, ...size }),
				expected,
				`${visible}/${reducedMotion}/${zero}`,
			);
		}
		assert.equal(motionState({ visible: true, reducedMotion: false, width: 800, height: 0 }), "suspended");
	});
});

// ---- Fakes for the renderer -------------------------------------------

class FakeFrames {
	now = 0;
	private nextId = 1;
	private callbacks = new Map<number, (t: number) => void>();
	request = (cb: (t: number) => void) => {
		const id = this.nextId++;
		this.callbacks.set(id, cb);
		return id;
	};
	cancel = (id: number) => {
		this.callbacks.delete(id);
	};
	get pending() {
		return this.callbacks.size;
	}
	tick(dt = 1000 / 120) {
		this.now += dt;
		const due = [...this.callbacks.values()];
		this.callbacks.clear();
		for (const cb of due) cb(this.now);
	}
	ticks(n: number, dt = 1000 / 120) {
		for (let i = 0; i < n; i++) this.tick(dt);
	}
}

class FakeTimers {
	now = 0;
	private nextId = 1;
	private timers = new Map<number, { fn: () => void; at: number }>();
	set = (fn: () => void, ms: number) => {
		const id = this.nextId++;
		this.timers.set(id, { fn, at: this.now + ms });
		return id;
	};
	clear = (id: number) => {
		this.timers.delete(id);
	};
	get pending() {
		return this.timers.size;
	}
	delays() {
		return [...this.timers.values()].map((t) => t.at - this.now);
	}
	advance(ms: number) {
		const end = this.now + ms;
		for (;;) {
			const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
			if (!next || next[1].at > end) break;
			this.timers.delete(next[0]);
			this.now = next[1].at;
			next[1].fn();
		}
		this.now = end;
	}
}

interface Op {
	op: string;
	args: unknown[];
	alpha: number;
	fill: unknown;
	t: number;
}

function fakeContext(canvas: HTMLCanvasElement, clock: { now: number }) {
	const ops: Op[] = [];
	const record =
		(op: string) =>
		(...args: unknown[]) => {
			ops.push({ op, args, alpha: ctx.globalAlpha, fill: ctx.fillStyle, t: clock.now });
		};
	const ctx = {
		canvas,
		ops,
		globalAlpha: 1,
		fillStyle: "#000" as unknown,
		clearRect: record("clearRect"),
		fillRect: record("fillRect"),
		beginPath: record("beginPath"),
		arc: record("arc"),
		fill: record("fill"),
		drawImage: record("drawImage"),
		setTransform: record("setTransform"),
		createRadialGradient: (...args: unknown[]) => {
			const stops: [number, string][] = [];
			ops.push({ op: "createRadialGradient", args, alpha: ctx.globalAlpha, fill: stops, t: clock.now });
			return { stops, addColorStop: (o: number, c: string) => stops.push([o, c]) };
		},
	};
	return ctx;
}
type FakeCtx = ReturnType<typeof fakeContext>;

function setupSky(opts: {
	viewport?: Viewport;
	visible?: boolean;
	reducedMotion?: boolean;
	colors?: SkyColors;
	animate?: SkyDeps["animate"];
	rand?: Rand;
}) {
	const frames = new FakeFrames();
	const timers = new FakeTimers();
	const vp: Viewport = opts.viewport ?? { width: 800, height: 600, dpr: 1 };
	const colors: SkyColors = opts.colors ?? { star: "#aabbcc", glow: "#112233" };
	const contexts = new Map<HTMLCanvasElement, FakeCtx>();
	const sprites: HTMLCanvasElement[] = [];
	let reads = 0;
	const container = document.createElement("div");
	container.className = "starrynight-bg-container";
	document.body.appendChild(container);
	const deps: SkyDeps = {
		container,
		rand: opts.rand ?? lcg(1),
		viewport: () => ({ ...vp }),
		getContext: (canvas) => {
			let c = contexts.get(canvas);
			if (!c) contexts.set(canvas, (c = fakeContext(canvas, frames)));
			return c as unknown as CanvasRenderingContext2D;
		},
		createCanvas: () => {
			const c = document.createElement("canvas");
			sprites.push(c);
			return c;
		},
		requestFrame: frames.request,
		cancelFrame: frames.cancel,
		setTimer: timers.set,
		clearTimer: timers.clear,
		animate:
			opts.animate ?? (() => ({ play() {}, pause() {}, cancel() {}, onfinish: null }) satisfies AnimationHandle),
		readColors: () => {
			reads++;
			return { ...colors };
		},
	};
	const sky = createSky(deps, { visible: opts.visible ?? true, reducedMotion: opts.reducedMotion ?? false });
	const canvas = (cls: string) => container.querySelector<HTMLCanvasElement>(`canvas.${cls}`)!;
	const ctxOf = (cls: string) => deps.getContext(canvas(cls)) as unknown as FakeCtx;
	const staticCtx = () => ctxOf("starrynight-static");
	const twinkleCtx = () => ctxOf("starrynight-twinkle");
	const dots = (c: FakeCtx) => c.ops.filter((o) => o.op === "fillRect" || o.op === "arc");
	// A static pass starts with a whole-canvas clear.
	const staticPasses = () => staticCtx().ops.filter((o) => o.op === "clearRect").length;
	// Every twinkle batch redraws every twinkling dot; glows at zero are skipped.
	const batchTimes = () => new Set(dots(twinkleCtx()).map((o) => o.t));
	return {
		sky,
		deps,
		frames,
		timers,
		vp,
		colors,
		sprites,
		container,
		reads: () => reads,
		canvas,
		staticCtx,
		twinkleCtx,
		dots,
		staticPasses,
		batchTimes,
	};
}

describe("starry-night canvas sky", () => {
	it("appends two canvases and a color sentinel", () => {
		const t = setupSky({});
		assert.ok(t.canvas("starrynight-static"));
		assert.ok(t.canvas("starrynight-twinkle"));
		assert.equal(t.container.querySelectorAll("span.starrynight-sentinel").length, 1);
	});

	it("draws the static layer once and caps twinkle batches (AC21)", () => {
		const t = setupSky({ viewport: { width: 3840, height: 1200, dpr: 1 } });
		t.frames.ticks(120);
		assert.equal(t.staticPasses(), 1);
		const batches = t.batchTimes();
		assert.ok(batches.size <= TWINKLE_FPS, `batches ${batches.size}`);
		assert.ok(batches.size >= TWINKLE_FPS - 4, `batches ${batches.size}`);
		const first = Math.min(...batches);
		const twinkling = t.dots(t.twinkleCtx()).filter((o) => o.t === first).length;
		assert.ok(twinkling > 0);
		assert.equal(t.dots(t.staticCtx()).length + twinkling, starCount(3840, 1200));
	});

	it("regenerates at most once per frame while resizing, then once when settled (AC10)", () => {
		const t = setupSky({});
		t.frames.tick();
		assert.equal(t.staticPasses(), 1);
		t.vp.width = 900;
		t.vp.height = 700;
		for (let i = 0; i < 10; i++) t.sky.resize();
		t.frames.tick();
		assert.equal(t.staticPasses(), 2);
		assert.equal(t.canvas("starrynight-static").width, 900);
		t.frames.ticks(5);
		assert.equal(t.staticPasses(), 2);
		t.timers.advance(RESIZE_SETTLE_MS);
		t.frames.tick();
		assert.equal(t.staticPasses(), 3);
		t.frames.ticks(5);
		assert.equal(t.staticPasses(), 3);
	});

	it("resizes backing stores and rebuilds the glow sprite on a DPR change (AC23)", () => {
		const t = setupSky({});
		t.frames.tick();
		const spriteBefore = t.sprites.at(-1)!;
		const widthBefore = spriteBefore.width;
		t.vp.dpr = 1.5;
		t.sky.resize();
		t.frames.tick();
		const expected = backingSize(800, 600, 1.5);
		for (const cls of ["starrynight-static", "starrynight-twinkle"]) {
			assert.equal(t.canvas(cls).width, expected.width);
			assert.equal(t.canvas(cls).height, expected.height);
		}
		const spriteAfter = t.sprites.at(-1)!;
		assert.ok(spriteAfter !== spriteBefore || spriteAfter.width !== widthBefore);
		assert.ok(spriteAfter.width > widthBefore);
	});

	it("re-reads colors only on notification, coalesced, and waits while hidden (AC11)", () => {
		const t = setupSky({});
		assert.equal(t.reads(), 1);
		t.frames.tick();
		t.colors.star = "#ff0000";
		t.sky.colorsChanged();
		t.sky.colorsChanged();
		t.sky.colorsChanged();
		assert.equal(t.reads(), 1);
		t.frames.tick();
		assert.equal(t.reads(), 2);
		assert.equal(t.staticPasses(), 2);
		const now = t.frames.now;
		const fills = t.staticCtx().ops.filter((o) => o.op === "fillRect" && o.t === now);
		assert.ok(fills.length > 0 && fills.every((o) => o.fill === "#ff0000"));

		t.sky.setVisible(false);
		t.colors.star = "#00ff00";
		t.sky.colorsChanged();
		t.frames.ticks(3);
		t.timers.advance(1000);
		assert.equal(t.reads(), 2);
		assert.equal(t.staticPasses(), 2);
		t.sky.setVisible(true);
		t.frames.tick();
		assert.equal(t.reads(), 3);
		assert.equal(t.staticPasses(), 3);
	});

	it("stops twinkling and stops re-arming frames while hidden (AC12)", () => {
		const t = setupSky({});
		t.frames.ticks(10);
		t.sky.setVisible(false);
		const before = t.twinkleCtx().ops.length;
		t.frames.ticks(30);
		assert.equal(t.twinkleCtx().ops.length, before);
		assert.equal(t.frames.pending, 0);
	});

	it("draws twinkling stars once without glow under reduced motion (AC13)", () => {
		const t = setupSky({});
		t.frames.ticks(10);
		t.sky.setReducedMotion(true);
		const before = t.twinkleCtx().ops.length;
		t.frames.ticks(5);
		const after = t.twinkleCtx().ops.slice(before);
		assert.ok(after.length > 0);
		assert.equal(after.filter((o) => o.op === "drawImage").length, 0);
		assert.ok(t.dots({ ops: after } as FakeCtx).length > 0);
		assert.equal(t.frames.pending, 0);
		t.sky.setVisible(false);
		t.sky.setVisible(true);
		t.frames.ticks(5);
		assert.equal(
			t
				.twinkleCtx()
				.ops.slice(before)
				.filter((o) => o.op === "drawImage").length,
			0,
		);
		assert.equal(t.frames.pending, 0);
	});

	it("starts static when created under reduced motion (AC13)", () => {
		const t = setupSky({ reducedMotion: true });
		t.frames.ticks(5);
		assert.ok(t.dots(t.twinkleCtx()).length > 0);
		assert.equal(t.twinkleCtx().ops.filter((o) => o.op === "drawImage").length, 0);
		assert.equal(t.frames.pending, 0);
	});

	it("draws nothing for a zero-area viewport and recovers on resize (AC22)", () => {
		const t = setupSky({ viewport: { width: 0, height: 800, dpr: 1 } });
		t.frames.ticks(5);
		assert.equal(t.dots(t.staticCtx()).length + t.dots(t.twinkleCtx()).length, 0);
		t.vp.width = 800;
		t.vp.height = 600;
		t.sky.resize();
		t.frames.tick();
		const now = t.frames.now;
		const twinkling = t.dots(t.twinkleCtx()).filter((o) => o.t === now).length;
		assert.equal(t.dots(t.staticCtx()).length + twinkling, starCount(800, 600));
	});

	it("draws the field the first time a hidden start becomes visible (Review Focus 1)", () => {
		const t = setupSky({ visible: false, viewport: { width: 717, height: 1152, dpr: 1 } });
		t.frames.ticks(5);
		t.timers.advance(1000);
		assert.equal(t.staticCtx().ops.length + t.twinkleCtx().ops.length, 0);
		assert.notEqual(t.canvas("starrynight-static").width, 717);
		t.sky.setVisible(true);
		t.frames.tick();
		assert.equal(t.canvas("starrynight-static").width, 717);
		assert.equal(t.canvas("starrynight-static").height, 1152);
		assert.ok(t.dots(t.staticCtx()).length > 0);
	});

	it("falls back to white when the palette has no star colors (Review Focus 2)", () => {
		const t = setupSky({ colors: { star: "", glow: "" } });
		t.frames.tick();
		const fills = t.dots(t.staticCtx()).map((o) => o.fill);
		assert.ok(fills.length > 0 && fills.every((f) => f === FALLBACK_COLOR));
		const sprite = t.deps.getContext(t.sprites.at(-1)!) as unknown as { shadowColor: string };
		assert.equal(sprite.shadowColor, FALLBACK_COLOR);
	});

	it("recolors the static sky under reduced motion without starting animation (Review Focus 3)", () => {
		const t = setupSky({ reducedMotion: true });
		t.frames.tick();
		t.colors.star = "#123456";
		t.sky.colorsChanged();
		t.frames.tick();
		const now = t.frames.now;
		const fills = t.dots(t.staticCtx()).filter((o) => o.t === now);
		assert.ok(fills.length > 0 && fills.every((o) => o.fill === "#123456"));
		assert.equal(t.frames.pending, 0);
		assert.equal(t.twinkleCtx().ops.filter((o) => o.op === "drawImage").length, 0);
	});

	it("draws one batch after a long hidden gap, with alphas in range (Review Focus 4)", () => {
		const t = setupSky({});
		t.frames.ticks(10);
		t.sky.setVisible(false);
		t.sky.setVisible(true);
		const before = t.batchTimes().size;
		t.frames.tick(3_600_000);
		assert.equal(t.batchTimes().size, before + 1);
		t.frames.tick();
		assert.equal(t.batchTimes().size, before + 1);
		for (const c of [t.staticCtx(), t.twinkleCtx()]) {
			for (const o of c.ops) assert.ok(o.alpha >= 0 && o.alpha <= 1, `alpha ${o.alpha}`);
		}
	});
});

// ---- Shooting stars ----------------------------------------------------

class FakeAnimation implements AnimationHandle {
	onfinish: (() => void) | null = null;
	state: "running" | "paused" | "cancelled" | "finished" = "running";
	readonly el: HTMLElement;
	readonly keyframes: Keyframe[];
	readonly options: KeyframeAnimationOptions;
	constructor(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
		this.el = el;
		this.keyframes = keyframes;
		this.options = options;
	}
	play() {
		this.state = "running";
	}
	pause() {
		this.state = "paused";
	}
	cancel() {
		this.state = "cancelled";
	}
	finish() {
		this.state = "finished";
		this.onfinish?.();
	}
}

function setupShooting(opts: Parameters<typeof setupSky>[0] = {}) {
	const flights: FakeAnimation[] = [];
	const t = setupSky({
		...opts,
		animate: (el, keyframes, options) => {
			const a = new FakeAnimation(el, keyframes, options);
			flights.push(a);
			return a;
		},
	});
	const live = () => flights.filter((f) => f.state === "running" || f.state === "paused");
	const stars = () => [...t.container.querySelectorAll<HTMLElement>("span.shootingstar")];
	return { ...t, flights, live, stars };
}

// The distance a flight was given, read back from its last keyframe.
const flownDistance = (f: FakeAnimation) =>
	Number(/translateX\(-([\d.e+-]+)px\)/.exec(String(f.keyframes[2].transform))![1]);
const launchOf = (f: FakeAnimation) => ({
	x: Number.parseFloat(f.el.style.left),
	y: Number.parseFloat(f.el.style.top),
});

describe("starry-night shooting stars on screen", () => {
	it("flies four independent stars along exit-aware paths (AC8)", () => {
		const t = setupShooting({ viewport: { width: 717, height: 1152, dpr: 1 } });
		assert.equal(t.stars().length, 4);
		t.timers.advance(6000);
		assert.equal(t.flights.length, 4);
		assert.equal(new Set(t.flights.map((f) => f.el)).size, 4);
		for (const f of t.flights) {
			assert.ok(f.el.classList.contains("shootingstar"));
			const d = flownDistance(f);
			assert.deepEqual(f.keyframes, flightKeyframes(d));
			assert.ok(Math.abs(d - flightDistance(launchOf(f), 717, 1152)) < 1e-6);
			const duration = Number(f.options.duration);
			assert.ok(duration >= (d / 500) * 1000 - 1e-6 && duration <= (d / 250) * 1000 + 1e-6);
			assert.equal(f.options.easing, "linear");
			assert.match(f.el.style.left, /px$/);
			assert.match(f.el.style.top, /px$/);
		}
	});

	it("delays only the first flight and relaunches straight from finish (AC9)", () => {
		const draws = [0.1, 0.5, 0.99, 0];
		const rest = lcg(9);
		const t = setupShooting({ rand: () => (draws.length ? draws.shift()! : rest()) });
		assert.deepEqual(
			t.timers.delays().sort((a, b) => a - b),
			[0, 0, 3000, 6000],
		);
		t.timers.advance(6000);
		const timersBefore = t.timers.pending;
		t.flights[0].finish();
		assert.equal(t.flights.length, 5);
		assert.equal(t.flights[4].el, t.flights[0].el);
		assert.equal(t.timers.pending, timersBefore);

		t.sky.setVisible(false);
		t.flights[1].finish();
		assert.equal(t.flights.length, 5);
		t.sky.setVisible(true);
		t.sky.setReducedMotion(true);
		const count = t.flights.length;
		t.flights[2].onfinish?.();
		assert.equal(t.flights.length, count);
		t.sky.setReducedMotion(false);
		const after = t.flights.length;
		t.sky.dispose();
		for (const f of t.flights) f.onfinish?.();
		assert.equal(t.flights.length, after);
	});

	it("lets a flight finish across a resize and uses the new size next (AC10)", () => {
		const t = setupShooting();
		t.timers.advance(6000);
		const first = t.flights[0];
		t.vp.width = 1600;
		t.vp.height = 900;
		t.sky.resize();
		assert.equal(first.state, "running");
		first.finish();
		const next = t.flights.at(-1)!;
		assert.ok(Math.abs(flownDistance(next) - flightDistance(launchOf(next), 1600, 900)) < 1e-6);
	});

	it("pauses while hidden and launches a missed first flight on return (AC12)", () => {
		const t = setupShooting();
		t.timers.advance(6000);
		t.sky.setVisible(false);
		assert.ok(t.live().every((f) => f.state === "paused"));
		t.sky.setVisible(true);
		assert.ok(t.live().length === 4 && t.live().every((f) => f.state === "running"));

		const h = setupShooting({ visible: false });
		h.timers.advance(6000);
		assert.equal(h.flights.length, 0);
		h.sky.setVisible(true);
		assert.equal(h.flights.length, 4);
	});

	it("hides shooting stars under reduced motion and relaunches without delay (AC13)", () => {
		const t = setupShooting();
		t.timers.advance(6000);
		const flying = t.live();
		t.sky.setReducedMotion(true);
		assert.ok(flying.every((f) => f.state === "cancelled"));
		assert.ok(t.stars().every((el) => el.hidden));
		const timers = t.timers.pending;
		t.sky.setReducedMotion(false);
		assert.equal(t.live().length, 4);
		assert.equal(t.timers.pending, timers);
		assert.ok(t.stars().every((el) => !el.hidden));

		const r = setupShooting({ reducedMotion: true });
		r.timers.advance(6000);
		assert.equal(r.flights.length, 0);
	});

	it("launches nothing at zero area and resumes when the area returns (AC22)", () => {
		const t = setupShooting({ viewport: { width: 0, height: 800, dpr: 1 } });
		t.timers.advance(6000);
		assert.equal(t.flights.length, 0);
		t.vp.width = 800;
		t.sky.resize();
		assert.equal(t.flights.length, 4);

		t.vp.height = 0;
		t.sky.resize();
		t.flights[0].finish();
		assert.equal(t.flights.length, 4);
		t.vp.height = 600;
		t.sky.resize();
		assert.equal(t.flights.length, 5);
	});
});
