#!/usr/bin/env node
/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * theme-report - screenshot every theme, audit its colours, and say what moved.
 *
 * A local tool, not a gate. It drives the running Spotify client over CDP,
 * captures every theme across a handful of routes, compares each frame with
 * the last accepted run, checks each theme still binds to this build, folds in
 * a contrast audit of every scheme, and opens the generated report.
 *
 *   node scripts/theme-report.ts                  capture, compare, write
 *   node scripts/theme-report.ts --accept         make this run the baseline
 *   node scripts/theme-report.ts --no-capture     rebuild the page from disk
 *   node scripts/theme-report.ts --no-open        write without opening a browser
 *   node scripts/theme-report.ts --themes flow    just one
 *   node scripts/theme-report.ts --routes /       just one route
 *   node scripts/theme-report.ts --suite classmaps --baseline-dir ../classmaps/visual/baseline --out /tmp/classmaps-run
 *   node scripts/theme-report.ts --suite classmaps --baseline-dir ../classmaps/visual/baseline --out /tmp/classmaps-run --no-capture --prepare-baseline /tmp/classmaps-candidates
 *   node scripts/theme-report.ts --selector .main-actionButtons  toolbar only
 *
 * Spotify must be running with --remote-debugging-port=9229. Output defaults
 * to ../scratchpad/theme-shots, which is outside every repo.
 *
 * Four checks, and they cover different things on purpose:
 *
 *   what moved     each frame against the last accepted run, so an intended
 *                  change is reviewed once and everything else stays quiet
 *   binding        each theme against the bare client, because applying a
 *                  theme's variables is not the same as its rules matching
 *   contrast       every scheme of every theme, including the 96 no screenshot
 *                  ever shows, which is the only place they are checked at all
 *   animation      a surface that never settles cannot be tracked, and saying
 *                  so beats reporting it as changed every run
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));

/* -------------------------- Scheme resolution, shared with the client loader */

// Canonical keys a theme may omit, each with the keys to derive it from,
// first match wins. Order is load-bearing: entries resolve against keys
// filled earlier in the same pass.
export const DERIVED_COLORS: Array<[string, string[]]> = [
	["subtext", ["text"]],
	["main-elevated", ["card", "main"]],
	["card", ["main-elevated", "main"]],
	["highlight", ["card-hover", "main-elevated", "main"]],
	["highlight-elevated", ["highlight", "main"]],
	["sidebar", ["main"]],
	["player", ["main"]],
	["tab-active", ["card", "main"]],
	["selected-row", ["text"]],
	["misc", ["subtext", "text"]],
	["button", ["button-active", "text"]],
	["button-active", ["button", "text"]],
	["button-disabled", ["subtext", "text"]],
	["shadow", ["text"]],
	["notification", ["card", "main"]],
	["notification-error", ["notification", "main"]],
];

export const THEMED_CLASS = "spicetify-themed";

export interface ResolvedScheme {
	/** Section name from color.ini; "" for a file with no [Section] header. */
	name: string;
	/** Keys the scheme names itself, before any backfill. */
	declared: Record<string, string>;
	/** Keys after canonical backfill, as the loader would apply them. */
	resolved: Record<string, string>;
	/** Custom properties to set on the document element. */
	vars: Record<string, string>;
}

/**
 * parseColorSchemes parses classic spicetify color.ini into named schemes:
 * each [Section] is one scheme; keys before any section land in "".
 */
export function parseColorSchemes(text: string): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	let current = "";
	for (const line of text.split("\n")) {
		const raw = line.trim();
		if (!raw || raw.startsWith(";") || raw.startsWith("#")) continue;
		// Classic themes annotate values inline ("main = 000000 ; the sky").
		const comment = raw.indexOf(";");
		const trimmed = comment < 0 ? raw : raw.slice(0, comment).trim();
		if (!trimmed) continue;
		const section = trimmed.match(/^\[(.+)\]$/);
		if (section) {
			current = section[1].trim();
			out[current] ??= {};
			continue;
		}
		const eq = trimmed.indexOf("=");
		if (eq < 0) continue;
		// Keys lowercase because CSS custom properties are case-sensitive and
		// the classic CLI lowercased them; section names keep their case
		// because they are display labels, not variable names.
		const key = trimmed.slice(0, eq).trim().toLowerCase();
		const value = trimmed.slice(eq + 1).trim();
		if (key && value) (out[current] ??= {})[key] = value;
	}
	for (const name of Object.keys(out)) {
		if (!Object.keys(out[name]).length) delete out[name];
	}
	return out;
}

/**
 * fillCanonical returns the scheme with omitted canonical keys derived
 * from declared ones. Declared keys are never overwritten.
 */
export function fillCanonical(scheme: Record<string, string>): Record<string, string> {
	const out = { ...scheme };
	for (const [key, sources] of DERIVED_COLORS) {
		if (out[key] !== undefined) continue;
		const from = sources.find((s) => out[s] !== undefined);
		if (from) out[key] = out[from];
	}
	return out;
}

/** hexToRgb returns "r,g,b" for a 3- or 6-digit hex, or null when malformed. */
export function hexToRgb(hex: string): string | null {
	const h = hex.replace("#", "");
	if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(h)) return null;
	const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
	return `${Number.parseInt(full.slice(0, 2), 16)},${Number.parseInt(full.slice(2, 4), 16)},${Number.parseInt(full.slice(4, 6), 16)}`;
}

/**
 * schemeVars turns a resolved scheme into the custom properties the loader
 * sets: --spice-<key> for every entry, plus --spice-rgb-<key> when the
 * value parses as hex.
 */
export function schemeVars(scheme: Record<string, string>): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const [key, value] of Object.entries(scheme)) {
		vars[`--spice-${key}`] = value.startsWith("#") ? value : `#${value}`;
		const rgb = hexToRgb(value);
		if (rgb) vars[`--spice-rgb-${key}`] = rgb;
	}
	return vars;
}

/** listSchemes returns a theme's scheme names in file order. */
export function listSchemes(themeDir: string): string[] {
	const ini = path.join(themeDir, "color.ini");
	if (!existsSync(ini)) return [];
	return Object.keys(parseColorSchemes(readFileSync(ini, "utf8")));
}

/**
 * resolveScheme reads a theme's color.ini and resolves one scheme. Without
 * a name it picks the file's first, which is what the loader falls back to
 * when nothing is saved.
 *
 * Returns null when the theme has no scheme to apply at all - no color.ini,
 * or one that declares nothing. turntable ships exactly that: a comment and
 * an empty section, present only so `spicetify apply` stops complaining.
 * The loader treats it as "no colours" and applies none, so callers get the
 * same shape rather than an error they would have to special-case.
 *
 * Throws only when a scheme is asked for by name and the file does not have
 * it, which is a theme declaring a sampled scheme that does not exist.
 */
export function resolveScheme(themeDir: string, name?: string): ResolvedScheme | null {
	const ini = path.join(themeDir, "color.ini");
	if (!existsSync(ini)) return null;
	const schemes = parseColorSchemes(readFileSync(ini, "utf8"));
	const names = Object.keys(schemes);
	if (!names.length) return null;
	const picked = name ?? names[0];
	const declared = schemes[picked];
	if (!declared) {
		throw new Error(`${ini} has no scheme "${picked}" (has: ${names.join(", ")})`);
	}
	const resolved = fillCanonical(declared);
	return { name: picked, declared, resolved, vars: schemeVars(resolved) };
}

/* ------------------------------------------------------------ Contrast audit */

/**
 * Below this, in-client review found the failures real; above roughly 3:1 it
 * found them to be secondary text doing its job. Set under that boundary so
 * the gate only fires on what a reviewer confirmed, and raise it toward the
 * 4.5:1 AA bar for normal text as themes are fixed.
 */
export const MIN_RATIO = 2.75;

/**
 * Foreground candidates are tried in order and the first *declared* one
 * wins, mirroring how a theme that names `sidebar-text` means it to beat
 * the general `text` on that surface. Judging such a theme on `text` would
 * fail it for a colour it never puts there.
 */
export interface Pair {
	name: string;
	fg: string[];
	bg: string;
}

export const PAIRS: Pair[] = [
	{ name: "text on main", fg: ["text"], bg: "main" },
	{ name: "subtext on main", fg: ["subtext"], bg: "main" },
	{ name: "text on card", fg: ["text"], bg: "card" },
	{ name: "subtext on card", fg: ["subtext"], bg: "card" },
	{ name: "text on player", fg: ["player-text", "text"], bg: "player" },
	{ name: "text on sidebar", fg: ["sidebar-text", "text"], bg: "sidebar" },
	{ name: "text on highlight", fg: ["text"], bg: "highlight" },
];

export interface Finding {
	theme: string;
	scheme: string;
	pair: string;
	fgKey: string;
	bgKey: string;
	fg: string;
	bg: string;
	ratio: number;
}

export interface Malformed {
	theme: string;
	scheme: string;
	key: string;
	value: string;
}

export interface Audit {
	evaluated: number;
	skipped: number;
	findings: Finding[];
	malformed: Malformed[];
}

/** channelLuminance linearises one sRGB channel given as 0-255. */
function channelLuminance(c: number): number {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** relativeLuminance implements WCAG relative luminance for an "r,g,b" triple. */
export function relativeLuminance(rgb: string): number {
	const [r, g, b] = rgb.split(",").map(Number);
	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** contrastRatio returns the WCAG ratio between two "r,g,b" triples, 1-21. */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * auditScheme evaluates one scheme.
 *
 * Only pairs whose background *and* a foreground candidate are declared get
 * evaluated. fillCanonical backfills omitted keys from whatever the theme
 * did define, and several backgrounds fall back to `text` - `selected-row`
 * among them - so a derived pair can be text-on-text and score 1:1 for a
 * theme that simply stayed quiet. Those are the theme's silence, not its
 * choice, and gating on them would report a defect that does not exist.
 */
export function auditScheme(theme: string, scheme: string, declared: Record<string, string>): Audit {
	const audit: Audit = { evaluated: 0, skipped: 0, findings: [], malformed: [] };
	const resolved = fillCanonical(declared);
	for (const pair of PAIRS) {
		const fgKey = pair.fg.find((k) => declared[k] !== undefined);
		if (!fgKey || declared[pair.bg] === undefined) {
			audit.skipped++;
			continue;
		}
		const fg = resolved[fgKey];
		const bg = resolved[pair.bg];
		const fgRgb = hexToRgb(fg);
		const bgRgb = hexToRgb(bg);
		if (!fgRgb) audit.malformed.push({ theme, scheme, key: fgKey, value: fg });
		if (!bgRgb) audit.malformed.push({ theme, scheme, key: pair.bg, value: bg });
		if (!fgRgb || !bgRgb) continue;
		audit.evaluated++;
		const ratio = contrastRatio(fgRgb, bgRgb);
		if (ratio < MIN_RATIO) {
			audit.findings.push({ theme, scheme, pair: pair.name, fgKey, bgKey: pair.bg, fg, bg, ratio });
		}
	}
	return audit;
}

/** auditTheme evaluates every scheme a theme declares. */
export function auditTheme(themesDir: string, theme: string): Audit {
	const total: Audit = { evaluated: 0, skipped: 0, findings: [], malformed: [] };
	const ini = path.join(themesDir, theme, "color.ini");
	if (!existsSync(ini)) return total;
	for (const [name, declared] of Object.entries(parseColorSchemes(readFileSync(ini, "utf8")))) {
		const one = auditScheme(theme, name || "(default)", declared);
		total.evaluated += one.evaluated;
		total.skipped += one.skipped;
		total.findings.push(...one.findings);
		total.malformed.push(...one.malformed);
	}
	return total;
}

/** auditAll evaluates the named themes, or every theme in the directory. */
export function auditAll(themesDir: string, only: string[] = []): Audit {
	const themes = only.length
		? only
		: readdirSync(themesDir).filter((t) => existsSync(path.join(themesDir, t, "color.ini")));
	const total: Audit = { evaluated: 0, skipped: 0, findings: [], malformed: [] };
	for (const theme of themes.sort()) {
		const one = auditTheme(themesDir, theme);
		total.evaluated += one.evaluated;
		total.skipped += one.skipped;
		total.findings.push(...one.findings);
		total.malformed.push(...one.malformed);
	}
	return total;
}

/* ---------------------------------------------------------- Pixel comparison */

/**
 * How far two consecutive captures may drift and still count as settled.
 *
 * Above the incidental motion the client always has (a playing-indicator
 * equaliser is about 0.04% of a frame) and well below what an animated theme
 * moves, which is a quarter of a percent and up.
 */
export const STABLE_EPSILON = 0.001;

/** Per-pixel colour tolerance, 0-1. Absorbs anti-aliasing, not layout. */
export const PIXEL_THRESHOLD = 0.1;

export interface PixelComparison {
	changedPixels: number;
	totalPixels: number;
	changedRatio: number;
	/** Encoded delta image, or null when the two could not be compared. */
	delta: Buffer | null;
	/** Set when the images cannot be compared at all. */
	mismatch?: string;
}

/**
 * comparePng returns the share of pixels that differ.
 *
 * Different dimensions are reported as a mismatch rather than a pixel count:
 * comparing the overlap would quietly score a render that moved everything by
 * one row as almost identical.
 */
export function comparePng(baseline: Buffer, actual: Buffer, threshold = PIXEL_THRESHOLD): PixelComparison {
	const a = PNG.sync.read(baseline);
	const b = PNG.sync.read(actual);
	if (a.width !== b.width || a.height !== b.height) {
		return {
			changedPixels: 0,
			totalPixels: 0,
			changedRatio: 1,
			delta: null,
			mismatch: `baseline is ${a.width}x${a.height}, render is ${b.width}x${b.height}`,
		};
	}
	const diff = new PNG({ width: a.width, height: a.height });
	const changedPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold });
	const totalPixels = a.width * a.height;
	return {
		changedPixels,
		totalPixels,
		changedRatio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
		delta: PNG.sync.write(diff),
	};
}

/* ----------------------------------------------------- Live capture over CDP */

export const DEFAULT_PORT = 9229;

/** Routes worth a frame, and the name each gets on disk. */
export const ROUTES: Record<string, string> = {
	"/": "home",
	"/collection/tracks": "playlist",
	"/search": "search",
	"/preferences": "settings",
};

/** Runs in the real client; geometry from a DOM emulator is not evidence. */
export function readSettingsControls() {
	const appearance = (element: Element | null) => {
		if (!element) return null;
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return {
			classes: element.getAttribute("class"),
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
			color: style.color,
			background: style.backgroundColor,
			radius: style.borderRadius,
			opacity: style.opacity,
		};
	};
	return {
		buttons: [...document.querySelectorAll(".x-settings-row :is(button, a[data-encore-id])")].map((element) => ({
			id: element.id,
			tag: element.tagName,
			label: element.textContent?.trim(),
			appearance: appearance(element),
			icon: appearance(element.querySelector("svg")),
		})),
		toggles: [...document.querySelectorAll('.x-settings-row input[type="checkbox"]')].map((input) => ({
			id: input.id,
			checked: input.matches(":checked"),
			disabled: input.matches(":disabled"),
			track: appearance(input.parentElement?.querySelector(".x-toggle-indicatorWrapper") ?? null),
			thumb: appearance(input.parentElement?.querySelector(".x-toggle-indicator") ?? null),
		})),
	};
}

export interface LiveShot {
	theme: string;
	themeVersion?: string;
	scheme: string | null;
	route: string;
	surface: string;
	file: string;
	/** The resolved --spice-main, proof the frame is the theme it claims. */
	main: string;
	/** False when the surface never stopped moving, so it animates. */
	stable: boolean;
	/** Present on Settings captures; empty arrays mean controls were not found. */
	settingsControls?: ReturnType<typeof readSettingsControls>;
}

export interface LiveFailure {
	theme: string;
	error: string;
}

export interface LiveResult {
	shots: LiveShot[];
	failures: LiveFailure[];
	restored: string | null;
	clientVersion: string | null;
	moduleVersions?: Record<string, string>;
	viewport?: { width: number; height: number; dpr: number };
	selector?: string;
	suite?: "classmaps";
	cleanupVerified?: boolean;
	navigation?: string;
}

interface CaptureClip {
	x: number;
	y: number;
	width: number;
	height: number;
	dpr: number;
}

export function cropScreenshot(buffer: Buffer, clip: CaptureClip): Buffer {
	const source = PNG.sync.read(buffer);
	const x = Math.floor(clip.x * clip.dpr);
	const y = Math.floor(clip.y * clip.dpr);
	const width = Math.ceil((clip.x + clip.width) * clip.dpr) - x;
	const height = Math.ceil((clip.y + clip.height) * clip.dpr) - y;
	if (
		clip.width <= 0 ||
		clip.height <= 0 ||
		clip.dpr <= 0 ||
		![x, y, width, height].every(Number.isFinite) ||
		x < 0 ||
		y < 0 ||
		width <= 0 ||
		height <= 0 ||
		x + width > source.width ||
		y + height > source.height
	) {
		throw new Error("Screenshot selector must have a visible box fully inside the viewport");
	}
	const cropped = new PNG({ width, height });
	PNG.bitblt(source, cropped, x, y, width, height, 0, 0);
	return PNG.sync.write(cropped);
}

/** Minimal CDP client: one socket, request/response by id. */
export class Cdp {
	private ws!: WebSocket;
	private id = 0;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	static async attach(port: number): Promise<Cdp> {
		const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
			url?: string;
			webSocketDebuggerUrl?: string;
		}[];
		const page = targets.find((t) => (t.url ?? "").includes("xpui") && t.webSocketDebuggerUrl);
		if (!page?.webSocketDebuggerUrl) {
			throw new Error(`no xpui target on :${port} - start Spotify with --remote-debugging-port=${port}`);
		}
		const cdp = new Cdp();
		cdp.ws = new WebSocket(page.webSocketDebuggerUrl);
		cdp.ws.addEventListener("message", (ev: MessageEvent) => {
			const m = JSON.parse(String(ev.data));
			if (m.id && cdp.pending.has(m.id)) {
				const pending = cdp.pending.get(m.id)!;
				if (m.error) pending.reject(new Error(JSON.stringify(m.error)));
				else pending.resolve(m.result);
				cdp.pending.delete(m.id);
			}
		});
		await new Promise((r) => cdp.ws.addEventListener("open", r, { once: true }));
		await cdp.call("Runtime.enable");
		await cdp.call("Page.enable");
		return cdp;
	}

	call(method: string, params: Record<string, unknown> = {}): Promise<any> {
		const id = ++this.id;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP ${method} timed out`));
			}, 20000);
			this.pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	/** Evaluate in the page. The body may await and must return a value. */
	async eval<T>(body: string): Promise<T> {
		const r = await this.call("Runtime.evaluate", {
			expression: `(async () => { ${body} })()`,
			awaitPromise: true,
			returnByValue: true,
			allowUnsafeEvalBlockedByCSP: true,
		});
		if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
		return r?.result?.value as T;
	}

	wait(ms: number): Promise<void> {
		return this.eval(`return new Promise((r) => setTimeout(r, ${ms}));`);
	}

	/**
	 * Shoot once the frame stops moving.
	 *
	 * Comparing runs is only meaningful if a run compares against itself, and
	 * plenty moves on its own: lists finish virtualising, artwork arrives,
	 * gradients settle. Waiting for two identical frames costs a few hundred
	 * milliseconds and removes most of the noise.
	 *
	 * A theme that animates never settles. That is reported rather than waited
	 * out, because a frame of an animation cannot be tracked over time and
	 * saying so beats reporting it as a change every single run.
	 *
	 * Settled means "near enough", not byte-identical. Requiring exact equality
	 * once marked 57 of 60 frames animated because the playing-indicator
	 * equaliser on one card kept ticking over - 0.04% of the frame, enough to
	 * poison every capture. Genuinely animated themes move an order of
	 * magnitude more than that, so the two stay distinguishable.
	 */
	async shootStable(
		file: string,
		options: {
			tries?: number;
			gapMs?: number;
			selector?: string;
			epsilon?: number;
			beforeCapture?: () => Promise<unknown>;
			viewport?: { width: number; height: number };
		} = {},
	): Promise<boolean> {
		const { tries = 8, gapMs = 300, selector, epsilon = STABLE_EPSILON, beforeCapture, viewport } = options;
		let previous: Buffer | null = null;
		for (let i = 0; i < tries; i++) {
			await beforeCapture?.();
			const clip = selector
				? await this.eval<CaptureClip>(`
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error("Screenshot selector did not match");
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height, dpr: devicePixelRatio };
      `)
				: null;
			const shot = await this.call("Page.captureScreenshot", {
				format: "png",
				...(viewport ? { clip: { x: 0, y: 0, ...viewport, scale: 1 }, captureBeyondViewport: false } : {}),
			});
			const buffer = Buffer.from(shot.data, "base64");
			const current = clip ? cropScreenshot(buffer, clip) : buffer;
			if (previous) {
				const drift = comparePng(previous, current);
				if (!drift.mismatch && drift.changedRatio <= epsilon) {
					mkdirSync(path.dirname(file), { recursive: true });
					writeFileSync(file, current);
					return true;
				}
			}
			previous = current;
			await this.wait(gapMs);
		}
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, previous!);
		return false;
	}

	close(): void {
		this.ws.close();
	}
}

const mainColour = (cdp: Cdp) =>
	cdp.eval<string>(`return getComputedStyle(document.documentElement).getPropertyValue("--spice-main").trim();`);

/**
 * Neutralise what changes on its own, and put every view back to the top.
 *
 * The playback clock and its progress fill advance between one capture and the
 * next, so without this every frame carrying the playbar differs from the last
 * run for reasons that have nothing to do with any theme. They are pinned to a
 * fixed appearance rather than hidden, so the playbar is still themed and still
 * worth looking at. Scroll position is the other half: a list left where the
 * previous route put it renders different rows.
 */
const STABILISE = `
  const id = "spicetify-report-stabiliser";
  if (!document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = \`
      [data-testid="playback-position"], [data-testid="playback-duration"] { visibility: hidden !important; }
      [data-testid="playback-progressbar"] [data-testid="progress-bar"] > div > div { width: 0 !important; }
      [data-testid="playback-progressbar"] * { transition: none !important; animation: none !important; }
      /* Equalisers, spinners and hover fades all tick while a capture is
         being taken, and each one alone is enough to stop a frame settling.
         Removed rather than paused: pausing freezes each one wherever it had
         got to, which differs every run and diffs against itself. */
      *, *::before, *::after { animation: none !important; transition: none !important; }
    \`;
    document.head.appendChild(s);
  }
  for (const el of document.querySelectorAll("[data-overlayscrollbars-viewport], .main-view-container__scroll-node")) {
    el.scrollTop = 0;
  }
  window.scrollTo(0, 0);
  return true;`;

/**
 * Wait for the loader to finish applying a theme.
 *
 * Themes apply asynchronously, and a fixed sleep that ends early hands back a
 * frame of the *previous* theme: a perfectly good screenshot of the wrong
 * thing, which no later check can detect. Watching the variable actually
 * change is the only honest signal. Bounded, so a theme that legitimately
 * shares a background still proceeds rather than hanging the run.
 */
async function settle(cdp: Cdp, before: string): Promise<string> {
	let main = before;
	for (let i = 0; i < 20 && main === before; i++) {
		await cdp.wait(150);
		main = await mainColour(cdp);
	}
	return main;
}

export interface LiveOptions {
	outDir: string;
	selector?: string;
	port?: number;
	themes?: string[];
	routes?: string[];
	/**
	 * Theme ids to look for, normally the repo's themes directory.
	 *
	 * The client cannot be asked which of its modules are themes: `schemes()`
	 * answers for the enabled one only, and exactly one theme is enabled at a
	 * time, so asking it yields a list of one. Metadata tags are not in what
	 * `list()` returns either. The caller knows, so the caller says.
	 */
	candidates?: string[];
	/** Restore this theme afterwards instead of whatever is active now. */
	restoreTo?: string;
	/**
	 * Capture the client with every theme off first, as `_unthemed`.
	 *
	 * Reading --spice-main back proves a theme's variables landed, which is not
	 * the same as its stylesheet still matching anything: when a classmap leaf
	 * drifts, the colours apply and the rules select nothing. Comparing each
	 * theme against the bare client is what separates "applied" from "applied
	 * and visible".
	 */
	includeUnthemed?: boolean;
}

/** The name the bare-client frames are filed under. */
export const UNTHEMED = "_unthemed";

export async function captureLive(opts: LiveOptions): Promise<LiveResult> {
	const cdp = await Cdp.attach(opts.port ?? DEFAULT_PORT);
	const viewport = await cdp.eval<{ width: number; height: number; dpr: number }>(
		`return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };`,
	);
	const routes = opts.routes?.length ? opts.routes : Object.keys(ROUTES);
	const shots: LiveShot[] = [];
	const failures: LiveFailure[] = [];

	const clientVersion = await cdp.eval<string | null>(
		`return navigator.userAgent.match(/Spotify\\/(\\S+)/)?.[1] ?? null;`,
	);

	const known = await cdp.eval<{
		installed: { identifier: string; version: string }[];
		active: string | null;
		scheme: string | null;
	}>(`
    const active = localStorage.getItem("spicetify:modules:activeTheme");
    return {
      installed: window.Spicetify.Modules.list().map(({ identifier, version }) => ({ identifier, version })),
      active,
      scheme: active ? localStorage.getItem("spicetify:scheme:" + active) : null,
    };`);

	const installed = new Map(known.installed.map(({ identifier, version }) => [identifier, version]));
	const wanted = opts.themes?.length ? opts.themes : (opts.candidates ?? []);
	const restoreTo = opts.restoreTo ?? known.active;

	/** Walk the routes shooting each one, filed under `label`. */
	const tour = async (label: string, scheme: string | null, main: string) => {
		for (const route of routes) {
			const surface = ROUTES[route] ?? (route.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "root");
			await cdp.eval(`window.Spicetify.Platform.History.push(${JSON.stringify(route)}); return true;`);
			await cdp.wait(900);
			await cdp.eval(STABILISE);
			const file = path.join(opts.outDir, `${label}--${surface}.png`);
			const stable = await cdp.shootStable(file, { selector: opts.selector });
			const settingsControls =
				route === "/preferences"
					? await cdp.eval<ReturnType<typeof readSettingsControls>>(
							`return (${readSettingsControls.toString()})();`,
						)
					: undefined;
			shots.push({
				theme: label,
				themeVersion: installed.get(label),
				scheme,
				route,
				surface,
				file: path.basename(file),
				main,
				stable,
				settingsControls,
			});
		}
	};

	try {
		if (opts.includeUnthemed && known.active) {
			const before = await mainColour(cdp);
			// Transient unload, not disable: disable now writes the persisted
			// disabled set, so a crash before the finally-restore would leave
			// the user's theme off on the next boot (with no theme loading at
			// all). unload just stops it for this capture. Fall back to disable
			// on a client whose loader predates unload, where disable was itself
			// transient.
			await cdp.eval(
				`const M = window.Spicetify.Modules; await (M.unload ?? M.disable).call(M, ${JSON.stringify(known.active)}); return true;`,
			);
			await settle(cdp, before);
			await tour(UNTHEMED, null, await mainColour(cdp));
		}

		for (const theme of wanted) {
			// A theme the client does not have cannot be shown, and enabling it
			// silently leaves the previous one on screen: a good frame of the
			// wrong theme. Say so instead.
			if (!installed.has(theme)) {
				failures.push({ theme, error: "not staged in this client" });
				continue;
			}

			const before = await mainColour(cdp);
			try {
				await cdp.eval(`await window.Spicetify.Modules.enable(${JSON.stringify(theme)}); return true;`);
			} catch (e) {
				failures.push({ theme, error: `enable failed: ${(e as Error).message.slice(0, 80)}` });
				continue;
			}
			const main = await settle(cdp, before);
			// schemes() only answers for the enabled theme, which this now is.
			const scheme = await cdp.eval<string | null>(
				`return window.Spicetify.Modules.schemes(${JSON.stringify(theme)})?.active ?? null;`,
			);

			await tour(theme, scheme, main);
		}
	} finally {
		if (restoreTo) {
			await cdp
				.eval(
					`const M = window.Spicetify.Modules;
           await M.enable(${JSON.stringify(restoreTo)});
           ${known.scheme && restoreTo === known.active ? `await M.setScheme(${JSON.stringify(restoreTo)}, ${JSON.stringify(known.scheme)});` : ""}
           window.Spicetify.Platform.History.push("/");
           return true;`,
				)
				.catch(() => {});
			await cdp.wait(700);
		}
		cdp.close();
	}

	return { shots, failures, restored: restoreTo, clientVersion, viewport, selector: opts.selector };
}

export const CLASSMAP_STATES = [
	{ surface: "home", route: "/" },
	{ surface: "home-profile", route: "/" },
	{ surface: "settings-top", route: "/preferences" },
	{ surface: "settings-library", route: "/preferences" },
	{ surface: "search", route: "/search" },
	{ surface: "liked-songs", route: "/collection/tracks" },
	{ surface: "spicetify-settings", route: "/bespoke/settings" },
];
export const CLASSMAP_VIEWPORT = { width: 1440, height: 1000, dpr: 1 };

export function classmapShots(): LiveShot[] {
	return ["unthemed", "text"].flatMap((theme) =>
		CLASSMAP_STATES.map(({ surface, route }) => ({
			theme,
			surface,
			route,
			scheme: theme === "text" ? "Spicetify" : null,
			file: `${theme}/${surface}.png`,
			main: "",
			stable: false,
		})),
	);
}

/** Missing or failed states never become reference images. */
export function classmapCompleteness(live: LiveResult, currentDir: string): string[] {
	const problems = live.failures.map((failure) => `${failure.theme}: ${failure.error}`);
	if (live.suite !== "classmaps") problems.push("not a classmaps suite");
	if (!live.clientVersion) problems.push("Spotify version was not recorded");
	if (!live.moduleVersions?.text) problems.push("module versions were not recorded");
	if (!live.cleanupVerified) problems.push("client cleanup was not verified");
	if (
		live.viewport?.width !== CLASSMAP_VIEWPORT.width ||
		live.viewport?.height !== CLASSMAP_VIEWPORT.height ||
		live.viewport?.dpr !== CLASSMAP_VIEWPORT.dpr
	)
		problems.push("viewport must be 1440x1000 at DPR 1");
	for (const expected of classmapShots()) {
		const shots = live.shots.filter((shot) => shot.file === expected.file);
		if (shots.length !== 1) {
			problems.push(`${expected.file}: expected exactly one capture`);
			continue;
		}
		const shot = shots[0];
		if (
			shot.theme !== expected.theme ||
			shot.surface !== expected.surface ||
			shot.route !== expected.route ||
			shot.scheme !== expected.scheme
		)
			problems.push(`${expected.file}: state or scheme mismatch`);
		if (shot.theme === "text" && shot.themeVersion !== live.moduleVersions?.text)
			problems.push(`${expected.file}: theme version mismatch`);
		if (!shot.stable) problems.push(`${expected.file}: unstable capture`);
		const file = path.join(currentDir, expected.file);
		if (!existsSync(file)) {
			problems.push(`${expected.file}: missing PNG`);
			continue;
		}
		try {
			const image = PNG.sync.read(readFileSync(file));
			if (image.width !== CLASSMAP_VIEWPORT.width || image.height !== CLASSMAP_VIEWPORT.height)
				problems.push(`${expected.file}: resized PNG`);
		} catch {
			problems.push(`${expected.file}: invalid PNG`);
		}
	}
	if (live.shots.length !== classmapShots().length) problems.push("unexpected capture count");
	return problems;
}

function existingAncestor(directory: string): string {
	let current = path.resolve(directory);
	while (!existsSync(current)) current = path.dirname(current);
	return current;
}

function owningRepo(directory: string): string | null {
	let current = realpathSync(existingAncestor(directory));
	while (true) {
		if (existsSync(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function requireOutsideGit(directory: string): void {
	if (owningRepo(directory)) throw new Error(`Capture artifacts must stay outside git: ${directory}`);
}

/** Copies candidates only; never replaces or approves an existing baseline. */
export function prepareClassmapBaseline(currentDir: string, destination: string, live: LiveResult): number {
	const problems = classmapCompleteness(live, currentDir);
	if (problems.length) throw new Error(`Cannot prepare incomplete suite:\n${problems.join("\n")}`);
	requireOutsideGit(destination);
	if (existsSync(destination)) throw new Error("Candidate destination already exists; choose a new directory");
	mkdirSync(destination, { recursive: true });
	try {
		for (const { file } of classmapShots()) {
			mkdirSync(path.dirname(path.join(destination, file)), { recursive: true });
			copyFileSync(path.join(currentDir, file), path.join(destination, file));
		}
	} catch (error) {
		rmSync(destination, { recursive: true, force: true });
		throw error;
	}
	return classmapShots().length;
}

/** A working branch's proposed replacements cannot compare against themselves. */
export function snapshotBaseline(
	baselineDir: string,
	destination: string,
	ref = "origin/main",
): { directory: string; source: string } {
	const repo = owningRepo(baselineDir);
	if (!repo) return { directory: baselineDir, source: `directory:${baselineDir}` };
	const ancestor = existingAncestor(baselineDir);
	const canonicalBaseline = path.join(realpathSync(ancestor), path.relative(ancestor, path.resolve(baselineDir)));
	const prefix = path.relative(repo, canonicalBaseline).split(path.sep).join("/");
	const commit = execFileSync("git", ["-C", repo, "rev-parse", "--verify", `${ref}^{commit}`], {
		encoding: "utf8",
	}).trim();
	const names = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", commit, "--", prefix], {
		encoding: "utf8",
	})
		.trim()
		.split("\n")
		.filter((name) => name.endsWith(".png"));
	requireOutsideGit(destination);
	if (existsSync(destination)) throw new Error("Reference snapshot destination already exists");
	mkdirSync(destination, { recursive: true });
	for (const name of names) {
		const file = path.join(destination, path.relative(prefix, name));
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(
			file,
			execFileSync("git", ["-C", repo, "show", `${commit}:${name}`], { maxBuffer: 30 * 1024 * 1024 }),
		);
	}
	return { directory: destination, source: `${commit}:${prefix}` };
}

/** Runs in Spotify. A route change alone does not prove the requested state. */
export function inspectClassmapState(surface: string, pathname: string): boolean {
	const visible = (element: Element | null | undefined) => {
		if (!element) return false;
		const r = element.getBoundingClientRect();
		return (
			r.width > 0 &&
			r.height > 0 &&
			r.top >= 0 &&
			r.bottom <= innerHeight &&
			getComputedStyle(element).visibility !== "hidden"
		);
	};
	const heading = (root: Element | Document, text: string) =>
		[...root.querySelectorAll("h1,h2,h3,[role=heading]")].find((element) => element.textContent?.trim() === text);
	const settings = document.querySelector(".x-settings-container");
	switch (surface) {
		case "home": {
			const home = document.querySelector('[data-testid="home-page"]');
			const rect = home?.getBoundingClientRect();
			return pathname === "/" && !!rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;
		}
		case "home-profile":
			return (
				pathname === "/" &&
				visible(document.querySelector('[role="menu"]')) &&
				[...document.querySelectorAll('[role="menuitem"]')].some(
					(item) => item.textContent?.trim() === "Settings" && visible(item),
				)
			);
		case "settings-top":
			return pathname === "/preferences" && !!settings && visible(heading(settings, "Settings"));
		case "settings-library":
			return (
				pathname === "/preferences" &&
				!!settings &&
				visible(heading(settings, "Your Library")) &&
				visible(
					settings.querySelector('[id="settings.library.compact-mode"]')?.closest(".x-settings-row") ?? null,
				)
			);
		case "search":
			return pathname === "/search" && visible(heading(document, "Browse all"));
		case "liked-songs":
			return pathname === "/collection/tracks" && visible(heading(document, "Liked Songs"));
		case "spicetify-settings":
			return pathname === "/bespoke/settings" && visible(heading(document, "Spicetify Settings"));
		default:
			return false;
	}
}

export function maskClassmapPrivacy(): void {
	document.getElementById("spicetify-report-privacy")?.remove();
	const layer = document.createElement("div");
	layer.id = "spicetify-report-privacy";
	layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
	const cover = (rect: DOMRect, element?: Element) => {
		if (element) {
			let left = Math.max(0, rect.left),
				top = Math.max(0, rect.top);
			let right = Math.min(innerWidth, rect.right),
				bottom = Math.min(innerHeight, rect.bottom);
			for (let parent: Element | null = element; parent; parent = parent.parentElement) {
				const style = getComputedStyle(parent);
				if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return;
				const bounds = parent.getBoundingClientRect();
				if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
					left = Math.max(left, bounds.left);
					right = Math.min(right, bounds.right);
				}
				if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
					top = Math.max(top, bounds.top);
					bottom = Math.min(bottom, bounds.bottom);
				}
			}
			rect = new DOMRect(left, top, right - left, bottom - top);
		}
		if (rect.width <= 0 || rect.height <= 0) return;
		let regions = [rect];
		if (element && !element.closest('[role="menu"]')) {
			for (const menu of document.querySelectorAll('[role="menu"]')) {
				const bounds = menu.getBoundingClientRect();
				regions = regions.flatMap((region) => {
					const left = Math.max(region.left, bounds.left),
						right = Math.min(region.right, bounds.right);
					const top = Math.max(region.top, bounds.top),
						bottom = Math.min(region.bottom, bounds.bottom);
					if (right <= left || bottom <= top) return [region];
					return [
						new DOMRect(region.left, region.top, region.width, top - region.top),
						new DOMRect(region.left, bottom, region.width, region.bottom - bottom),
						new DOMRect(region.left, top, left - region.left, bottom - top),
						new DOMRect(right, top, region.right - right, bottom - top),
					].filter((part) => part.width > 0 && part.height > 0);
				});
			}
		}
		for (const region of regions) {
			const mask = document.createElement("span");
			mask.style.cssText = `position:fixed;left:${region.x}px;top:${region.y}px;width:${region.width}px;height:${region.height}px;background:#555`;
			layer.append(mask);
		}
	};
	const coverText = (root: Element, text: string) => {
		if (root.getBoundingClientRect().height <= 0) return;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			let offset = node.textContent?.indexOf(text) ?? -1;
			while (offset >= 0) {
				const range = document.createRange();
				range.setStart(node, offset);
				range.setEnd(node, offset + text.length);
				for (const rect of range.getClientRects()) cover(rect, node.parentElement ?? root);
				offset = node.textContent?.indexOf(text, offset + text.length) ?? -1;
			}
		}
	};
	for (const input of document.querySelectorAll("input")) {
		if (!["text", "password", "email", "search", "url", "tel", "number"].includes(input.type)) continue;
		const inputStyle = getComputedStyle(input);
		if (inputStyle.opacity === "0" || inputStyle.visibility === "hidden" || inputStyle.display === "none") continue;
		const labels = [...(input.labels ?? [])].map((label) => label.textContent ?? "").join(" ");
		const labelledBy = (input.getAttribute("aria-labelledby") ?? "")
			.split(/\s+/)
			.map((id) => document.getElementById(id)?.textContent ?? "")
			.join(" ");
		const description = [
			input.id,
			input.name,
			input.autocomplete,
			input.getAttribute("aria-label"),
			input.placeholder,
			labels,
			labelledBy,
		].join(" ");
		if (
			input.value &&
			(/password|email/.test(input.type) ||
				/token|secret|password|api.?key|credential|username/i.test(description))
		) {
			const rect = input.getBoundingClientRect();
			const style = getComputedStyle(input);
			const inset = (value: string) => Number.parseFloat(value) || 0;
			const left = inset(style.borderLeftWidth) + inset(style.paddingLeft);
			const right = inset(style.borderRightWidth) + inset(style.paddingRight);
			const top = inset(style.borderTopWidth) + inset(style.paddingTop);
			const bottom = inset(style.borderBottomWidth) + inset(style.paddingBottom);
			cover(new DOMRect(rect.x + left, rect.y + top, rect.width - left - right, rect.height - top - bottom));
		}
	}
	for (const avatar of document.querySelectorAll(
		'[data-testid="user-widget-link"] img, [data-testid="user-widget-avatar"]',
	))
		cover(avatar.getBoundingClientRect());
	const playlistImages = new Set<Element>();
	for (const link of document.querySelectorAll('a[href^="/playlist/"], a[href^="spotify:playlist:"]')) {
		const text = link.textContent?.trim();
		if (text) coverText(link, text);
		const artworkRoot = link.closest('[data-encore-id="card"]') ?? link;
		for (const image of artworkRoot.querySelectorAll("img")) playlistImages.add(image);
	}
	for (const image of playlistImages) cover(image.getBoundingClientRect(), image);
	for (const subtitle of document.querySelectorAll(
		'p[data-encore-id="listRowSubtitle"][id^="listrow-subtitle-spotify:playlist:"]',
	)) {
		const text = subtitle.textContent ?? "";
		const separator = text.indexOf("•");
		const creator = separator === -1 ? "" : text.slice(separator + 1).trim();
		if (creator && creator !== "Spotify") coverText(subtitle, creator);
	}
	const ownerNames = new Set<string>();
	for (const owner of document.querySelectorAll('a[href^="/user/"], a[href^="spotify:user:"]')) {
		const name = owner.textContent?.trim();
		if (name && !/^(Spotify|Profile|Your profile)$/i.test(name)) {
			ownerNames.add(name);
			coverText(owner, name);
			for (const avatar of owner.querySelectorAll("img")) cover(avatar.getBoundingClientRect());
		}
	}
	const account = document.querySelector('[data-testid="user-widget-link"]')?.getAttribute("aria-label")?.trim();
	if (account && account !== "User menu") {
		ownerNames.add(account);
		for (const region of document.querySelectorAll(
			'[data-testid="user-widget-link"], [role="menu"], [role="tooltip"], .main-entityHeader-metaData, h1, h2, h3',
		)) {
			if (
				region.matches("h1,h2,h3") &&
				!/^Made for\b/i.test(region.textContent?.trim() ?? "") &&
				region.textContent?.trim() !== account
			)
				continue;
			coverText(region, account);
		}
	}

	for (const avatar of document.querySelectorAll<HTMLImageElement>(
		".main-entityHeader-metaData img.main-avatar-image",
	)) {
		if (ownerNames.has(avatar.alt.trim())) cover(avatar.getBoundingClientRect());
	}
	document.body.append(layer);
}

export function isLayoutPreference(key: string): boolean {
	return /(?:^|:)(?:ui\.right_sidebar_content|column-widths|ylx-(?:default|expanded)-state-nav-bar-width|left-sidebar-(?:default|expanded)-state-width|panel-width|left-sidebar-state)$/.test(
		key,
	);
}

export function hasAlbumsOnlyLibrary(): boolean {
	return (
		document.querySelector('[data-encore-id="chip"][aria-label="Albums"]')?.getAttribute("aria-checked") ===
			"true" && !document.querySelector('.Root__nav-bar [id^="listrow-subtitle-spotify:playlist:"]')
	);
}

export async function captureClassmaps(opts: Pick<LiveOptions, "outDir" | "port">): Promise<LiveResult> {
	const cdp = await Cdp.attach(opts.port ?? DEFAULT_PORT);
	const live: LiveResult = {
		shots: [],
		failures: [],
		restored: null,
		clientVersion: null,
		suite: "classmaps",
		cleanupVerified: false,
		viewport: CLASSMAP_VIEWPORT,
		navigation: "History.push for pages; profile dropdown opened through its visible button",
	};
	type SavedClientState = {
		route: string;
		active: string | null;
		scheme: string | null;
		width: number;
		height: number;
		dpr: number;
		zoom: number;
		storage: Record<string, string | null>;
		scroll: Array<{ index: number; top: number; left: number }>;
	};
	let saved: SavedClientState | null = null;
	try {
		saved = await cdp.eval<SavedClientState>(`
      const M = window.Spicetify?.Modules;
      if (!M?.unload || !M?.setScheme) throw new Error("Current module loader required");
      const zoom = window.Spicetify.Platform.SettingsAPI?.viewportZoom;
      if (!zoom?.getValue || !zoom?.setValue || typeof await zoom.getValue() !== "number") throw new Error("Spotify viewport zoom API unavailable");
      if (!/^en(?:-|$)/i.test(document.documentElement.lang)) throw new Error("Set Spotify UI language to English and restart before capturing");
      const preferred = localStorage.getItem("spicetify:modules:activeTheme");
      const active = M.list().some(module => module.identifier === preferred && module.loaded) ? preferred : null;
      const keys = ["spicetify:modules:activeTheme", "spicetify:modules:disabled", "spicetify:scheme:text", ...(active ? ["spicetify:scheme:" + active] : []), ...Object.keys(localStorage).filter(${isLayoutPreference.toString()})];
      const route = window.Spicetify.Platform.History.location;
      return { route: route.pathname + (route.search ?? "") + (route.hash ?? ""), active, scheme: active ? M.schemes(active)?.active ?? null : null, width: innerWidth, height: innerHeight, dpr: devicePixelRatio, zoom: await zoom.getValue(), storage: Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), scroll: [...document.querySelectorAll("[data-overlayscrollbars-viewport], .main-view-container__scroll-node")].map((el, index) => ({ index, top: el.scrollTop, left: el.scrollLeft })) };
    `);
		live.clientVersion = await cdp.eval(`return navigator.userAgent.match(/Spotify\\/(\\S+)/)?.[1] ?? null;`);
		live.moduleVersions = await cdp.eval(
			`return Object.fromEntries(window.Spicetify.Modules.list().map(module => [module.identifier, module.version]));`,
		);
		if (!(await cdp.eval(`return (${hasAlbumsOnlyLibrary.toString()})();`)))
			throw new Error("Select Albums in Your Library before capturing to exclude playlist titles and artwork");
		await cdp.eval(`await window.Spicetify.Platform.SettingsAPI.viewportZoom.setValue(0); return true;`);
		await cdp.wait(300);
		await cdp.call("Emulation.setDeviceMetricsOverride", {
			width: CLASSMAP_VIEWPORT.width,
			height: CLASSMAP_VIEWPORT.height,
			deviceScaleFactor: CLASSMAP_VIEWPORT.dpr,
			mobile: false,
		});
		const dimensions = await cdp.eval<{ width: number; height: number; dpr: number }>(
			`return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };`,
		);
		if (
			dimensions.width !== CLASSMAP_VIEWPORT.width ||
			dimensions.height !== CLASSMAP_VIEWPORT.height ||
			Math.abs(dimensions.dpr - 1) > 0.000001
		)
			throw new Error("Could not establish 1440x1000 DPR 1 viewport");
		if (saved.active)
			await cdp.eval(`await window.Spicetify.Modules.unload(${JSON.stringify(saved.active)}); return true;`);
		for (const theme of ["unthemed", "text"]) {
			try {
				await cdp.eval(
					theme === "text"
						? `const M = window.Spicetify.Modules; if (!await M.enable("text") || !M.setScheme("text", "Spicetify")) throw new Error("Text Spicetify scheme unavailable"); return true;`
						: `if (document.documentElement.classList.contains("spicetify-themed")) throw new Error("Theme remains active in unthemed reference"); return true;`,
				);
				await cdp.wait(500);
				for (const state of CLASSMAP_STATES) {
					try {
						await cdp.call("Input.dispatchKeyEvent", {
							type: "keyDown",
							key: "Escape",
							code: "Escape",
							windowsVirtualKeyCode: 27,
						});
						await cdp.call("Input.dispatchKeyEvent", {
							type: "keyUp",
							key: "Escape",
							code: "Escape",
							windowsVirtualKeyCode: 27,
						});
						await cdp.eval(
							`window.Spicetify.Platform.History.push(${JSON.stringify(state.route)}); return true;`,
						);
						await cdp.wait(1000);
						await cdp.eval(
							`for (const el of document.querySelectorAll("[data-overlayscrollbars-viewport], .main-view-container__scroll-node")) el.scrollTop = 0; window.scrollTo(0, 0); return true;`,
						);
						if (state.surface === "home-profile") {
							const point = await cdp.eval<{ x: number; y: number }>(
								`const button = document.querySelector('[data-testid="user-widget-link"]'); if (!button) throw new Error("Profile button missing"); const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };`,
							);
							await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
							await cdp.call("Input.dispatchMouseEvent", {
								type: "mousePressed",
								button: "left",
								clickCount: 1,
								...point,
							});
							await cdp.call("Input.dispatchMouseEvent", {
								type: "mouseReleased",
								button: "left",
								clickCount: 1,
								...point,
							});
						}
						if (state.surface === "settings-library")
							await cdp.eval(
								`const heading = [...document.querySelectorAll(".x-settings-container h2")].find(el => el.textContent.trim() === "Your Library"); if (!heading) throw new Error("Your Library settings heading missing"); heading.scrollIntoView({ block: "center" }); return true;`,
							);
						await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
						await cdp.wait(500);
						const check = `return (${inspectClassmapState.toString()})(${JSON.stringify(state.surface)}, window.Spicetify.Platform.History.location.pathname);`;
						if (!(await cdp.eval(check))) throw new Error("Requested page state is not visible");
						const file = `${theme}/${state.surface}.png`;
						const stable = await cdp.shootStable(path.join(opts.outDir, file), {
							tries: 12,
							gapMs: 350,
							epsilon: 0,
							beforeCapture: () =>
								cdp.eval(
									`if (!(${hasAlbumsOnlyLibrary.toString()})()) throw new Error("Albums-only library filter changed during capture"); (${maskClassmapPrivacy.toString()})(); return true;`,
								),
							viewport: { width: CLASSMAP_VIEWPORT.width, height: CLASSMAP_VIEWPORT.height },
						});
						if (!(await cdp.eval(check))) throw new Error("Requested state disappeared during capture");
						live.shots.push({
							theme,
							...state,
							themeVersion: live.moduleVersions?.[theme],
							file,
							scheme: theme === "text" ? "Spicetify" : null,
							main: await mainColour(cdp),
							stable,
						});
						if (!stable) live.failures.push({ theme, error: `${state.surface}: unstable capture` });
					} catch (error) {
						live.failures.push({
							theme,
							error: `${state.surface}: ${error instanceof Error ? error.message : String(error)}`,
						});
					}
				}
			} catch (error) {
				live.failures.push({ theme, error: error instanceof Error ? error.message : String(error) });
			}
		}
	} catch (error) {
		live.failures.push({ theme: "suite", error: error instanceof Error ? error.message : String(error) });
	} finally {
		if (saved) {
			try {
				await cdp
					.eval(`
          const saved = ${JSON.stringify(saved)}; const M = window.Spicetify.Modules;
          try {
            await M.unload("text");
            if (saved.active) { if (!await M.enable(saved.active)) throw new Error("Could not restore original theme"); if (saved.scheme && !M.setScheme(saved.active, saved.scheme)) throw new Error("Could not restore original scheme"); }
          } finally {
            for (const [key, value] of Object.entries(saved.storage)) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
            document.getElementById("spicetify-report-privacy")?.remove();
            window.Spicetify.Platform.History.push(saved.route);
          }
          return true;
        `)
					.catch((error) =>
						live.failures.push({
							theme: "cleanup",
							error: error instanceof Error ? error.message : String(error),
						}),
					);
				await cdp
					.eval(
						`await window.Spicetify.Platform.SettingsAPI.viewportZoom.setValue(${saved.zoom}); return true;`,
					)
					.catch((error) =>
						live.failures.push({
							theme: "cleanup",
							error: error instanceof Error ? error.message : String(error),
						}),
					);
				await cdp.wait(300);
				await cdp.call("Emulation.clearDeviceMetricsOverride");
				const native = await cdp.eval<{ width: number; height: number; dpr: number }>(
					`return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };`,
				);
				if (
					native.width !== saved.width ||
					native.height !== saved.height ||
					Math.abs(native.dpr - saved.dpr) > 0.00001
				)
					await cdp.call("Emulation.setDeviceMetricsOverride", {
						width: saved.width,
						height: saved.height,
						deviceScaleFactor: saved.dpr,
						mobile: false,
					});
				await cdp.wait(750);
				live.cleanupVerified = await cdp.eval(`
          const saved = ${JSON.stringify(saved)};
          for (const key of Object.keys(localStorage).filter(${isLayoutPreference.toString()})) if (!(key in saved.storage)) localStorage.removeItem(key);
          for (const [key, value] of Object.entries(saved.storage)) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
          const scroll = [...document.querySelectorAll("[data-overlayscrollbars-viewport], .main-view-container__scroll-node")];
          for (const entry of saved.scroll) if (scroll[entry.index]) { scroll[entry.index].scrollTop = entry.top; scroll[entry.index].scrollLeft = entry.left; }
          const scrollRestored = saved.scroll.every(entry => scroll[entry.index] && Math.abs(scroll[entry.index].scrollTop - entry.top) <= 1 && Math.abs(scroll[entry.index].scrollLeft - entry.left) <= 1);
          return scrollRestored && await window.Spicetify.Platform.SettingsAPI.viewportZoom.getValue() === saved.zoom && window.Spicetify.Platform.History.location.pathname + (window.Spicetify.Platform.History.location.search ?? "") + (window.Spicetify.Platform.History.location.hash ?? "") === saved.route && innerWidth === saved.width && innerHeight === saved.height && Math.abs(devicePixelRatio - saved.dpr) < 0.00001 && Object.entries(saved.storage).every(([key, value]) => localStorage.getItem(key) === value) && (saved.active ? window.Spicetify.Modules.list().some(module => module.identifier === saved.active && module.loaded) && (window.Spicetify.Modules.schemes(saved.active)?.active ?? null) === saved.scheme : !document.documentElement.classList.contains("spicetify-themed")) && !document.getElementById("spicetify-report-privacy");
        `);
				if (!live.cleanupVerified)
					live.failures.push({ theme: "cleanup", error: "Original client state did not restore exactly" });
				live.restored = saved.active;
			} catch (error) {
				live.failures.push({ theme: "cleanup", error: error instanceof Error ? error.message : String(error) });
			}
		}
		cdp.close();
	}
	return live;
}

/* ----------------------------------------- Report: comparison, binding, page */

export type ChangeStatus = "new" | "changed" | "same" | "resized" | "animated" | "missing" | "incomplete";

export interface ShotChange {
	shot: LiveShot;
	status: ChangeStatus;
	changedPixels: number;
	changedRatio: number;
	/** Written only when something moved, so there is something to look at. */
	deltaFile?: string;
}

/**
 * Below this a frame counts as unchanged.
 *
 * Must sit above STABLE_EPSILON: a capture is allowed to settle while still
 * drifting that much, so anything tighter would report the allowance itself as
 * a change on every run.
 */
export const CHANGE_RATIO = 0.002;

export function compareRun(
	currentDir: string,
	baselineDir: string,
	shots: LiveShot[],
	deltaDir: string,
	strict = false,
): ShotChange[] {
	return shots.map((shot) => {
		const current = path.join(currentDir, shot.file);
		const baseline = path.join(baselineDir, shot.file);
		if (!existsSync(current)) return { shot, status: "missing", changedPixels: 0, changedRatio: 0 };
		if (strict && !shot.stable) return { shot, status: "incomplete", changedPixels: 0, changedRatio: 0 };
		if (!existsSync(baseline)) return { shot, status: "new", changedPixels: 0, changedRatio: 0 };

		const result = comparePng(readFileSync(baseline), readFileSync(current));
		if (result.mismatch) return { shot, status: "resized", changedPixels: 0, changedRatio: 1 };

		// A surface that never stopped moving is animating, and an animation
		// differs from its own last frame by definition. Calling that a change
		// every run is how a tracking tool teaches its reader to ignore it.
		if (!shot.stable) {
			return { shot, status: "animated", changedPixels: result.changedPixels, changedRatio: result.changedRatio };
		}

		if (strict ? result.changedPixels === 0 : result.changedRatio <= CHANGE_RATIO) {
			return { shot, status: "same", changedPixels: result.changedPixels, changedRatio: result.changedRatio };
		}

		const deltaFile = path.join(deltaDir, shot.file);
		mkdirSync(path.dirname(deltaFile), { recursive: true });
		if (result.delta) writeFileSync(deltaFile, result.delta);
		return {
			shot,
			status: "changed",
			changedPixels: result.changedPixels,
			changedRatio: result.changedRatio,
			deltaFile: shot.file,
		};
	});
}

/**
 * How much of a surface a theme must repaint before it counts as binding.
 *
 * Measured rather than chosen: across the 14 themes on 1.2.94 the quietest
 * (turntable) repaints 7.6% of a surface and the loudest (matte) 88.8%, with
 * nothing in between anywhere near zero. A floor of 3% leaves the quietest real
 * theme more than twice the headroom it needs, so tripping it means a theme has
 * stopped selecting rather than chosen restraint.
 */
export const BINDING_FLOOR = 0.03;

export interface Binding {
	theme: string;
	surface: string;
	/** Share of pixels this theme changes against the bare client. */
	ratio: number;
	bound: boolean;
}

/**
 * Compare each theme against the client with no theme on it.
 *
 * Reading --spice-main back proves the loader applied a theme's variables. It
 * says nothing about whether its stylesheet still selects anything: when a
 * classmap leaf drifts the colours land and the rules match nothing, which is
 * how buttons once rendered nearly invisible while every probe passed. A theme
 * that repaints almost none of the client has stopped binding to this build.
 */
export function checkBinding(currentDir: string, shots: LiveShot[], floor = BINDING_FLOOR): Binding[] {
	const bare = new Map(
		shots.filter((s) => s.theme === UNTHEMED || s.theme === "unthemed").map((s) => [s.surface, s.file]),
	);
	const rows: Binding[] = [];
	for (const shot of shots) {
		if (shot.theme === UNTHEMED || shot.theme === "unthemed") continue;
		const reference = bare.get(shot.surface);
		if (!reference) continue;
		const result = comparePng(
			readFileSync(path.join(currentDir, reference)),
			readFileSync(path.join(currentDir, shot.file)),
		);
		if (result.mismatch) continue;
		rows.push({ theme: shot.theme, surface: shot.surface, ratio: result.changedRatio, bound: true });
	}

	// Judged on a theme's loudest surface, not each one.
	//
	// Plenty of themes restyle the library and leave settings and search close
	// to stock: turntable moves 0.7% of settings and 7.6% of the playlist, and
	// it is working exactly as written. Requiring every surface to clear the
	// floor calls that broken. A theme that has actually stopped binding
	// repaints nothing anywhere, so the loudest surface is the honest test.
	const best = new Map<string, number>();
	for (const r of rows) best.set(r.theme, Math.max(best.get(r.theme) ?? 0, r.ratio));
	for (const r of rows) r.bound = (best.get(r.theme) ?? 0) >= floor;
	return rows;
}

/** Promote the run just taken to be what the next one is measured against. */
export function accept(currentDir: string, baselineDir: string): number {
	requireOutsideGit(baselineDir);
	rmSync(baselineDir, { recursive: true, force: true });
	mkdirSync(baselineDir, { recursive: true });
	const files = readdirSync(currentDir).filter((f) => f.endsWith(".png"));
	for (const f of files) copyFileSync(path.join(currentDir, f), path.join(baselineDir, f));
	return files.length;
}

const esc = (s: unknown) =>
	String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(opts: {
	changes: ShotChange[];
	findings: Finding[];
	bindings: Binding[];
	live: LiveResult;
	capturedAt: string;
	hasBaseline: boolean;
}): string {
	const { changes, findings, bindings, live, capturedAt, hasBaseline } = opts;
	const bindingByTheme = new Map<string, number>();
	for (const b of bindings) bindingByTheme.set(b.theme, Math.max(bindingByTheme.get(b.theme) ?? 0, b.ratio));
	const unbound = [...bindingByTheme].filter(([, r]) => r < BINDING_FLOOR).map(([t]) => t);

	const themes = [...new Set(changes.map((c) => c.shot.theme))].sort();
	const byTheme = new Map(themes.map((t) => [t, changes.filter((c) => c.shot.theme === t)]));
	const findingsByTheme = new Map<string, Finding[]>();
	for (const f of findings) {
		if (!findingsByTheme.has(f.theme)) findingsByTheme.set(f.theme, []);
		findingsByTheme.get(f.theme)!.push(f);
	}

	const moved = changes.filter((c) => c.status === "changed" || c.status === "resized");
	const fresh = changes.filter((c) => c.status === "new");
	const animated = changes.filter((c) => c.status === "animated");

	const badge = (c: ShotChange) => {
		if (c.status === "same") return "";
		if (c.status === "missing" || c.status === "incomplete") return `<span class="badge moved">${c.status}</span>`;
		if (c.status === "new") return '<span class="badge new">new</span>';
		if (c.status === "animated") return '<span class="badge anim">animated</span>';
		if (c.status === "resized") return '<span class="badge moved">size changed</span>';
		return `<span class="badge moved">${(c.changedRatio * 100).toFixed(2)}% moved</span>`;
	};

	const shotFigure = (
		c: ShotChange,
	) => `<figure${c.status === "changed" || c.status === "resized" ? ' class="hit"' : ""}>
  <a href="current/${c.shot.file.split("/").map(encodeURIComponent).join("/")}"><img src="current/${c.shot.file.split("/").map(encodeURIComponent).join("/")}" alt="${esc(c.shot.theme)} ${esc(c.shot.surface)}" loading="lazy"></a>
  <figcaption>${esc(c.shot.surface)}${badge(c)}${c.deltaFile ? ` <a class="delta" href="delta/${c.deltaFile.split("/").map(encodeURIComponent).join("/")}">delta</a>` : ""}</figcaption>
  ${c.shot.settingsControls ? `<details><summary>Settings control styles and geometry</summary><pre>${esc(JSON.stringify(c.shot.settingsControls, null, 2))}</pre></details>` : ""}
</figure>`;

	const themeBlock = (theme: string) => {
		const shots = byTheme.get(theme) ?? [];
		const first = shots[0]?.shot;
		const issues = findingsByTheme.get(theme) ?? [];
		const worst = issues.length ? Math.min(...issues.map((f) => f.ratio)) : null;
		return `<section class="theme" id="theme-${esc(theme)}">
  <header>
    <h3>${esc(theme)}${first?.themeVersion ? ` <small>${esc(first.themeVersion)}</small>` : ""}</h3>
    <span class="dim"><span class="sw" style="background:${esc(first?.main ?? "#000")}"></span>${esc(first?.scheme ?? "no scheme")} · ${esc(first?.main ?? "")}</span>
    ${bindingByTheme.has(theme) ? `<span class="dim${bindingByTheme.get(theme)! < BINDING_FLOOR ? " hit" : ""}">repaints ${(bindingByTheme.get(theme)! * 100).toFixed(0)}% of the bare client${bindingByTheme.get(theme)! < BINDING_FLOOR ? " — not binding" : ""}</span>` : ""}
    ${worst !== null ? `<span class="dim warn">${issues.length} contrast issue${issues.length === 1 ? "" : "s"}, worst ${worst.toFixed(2)}:1</span>` : ""}
  </header>
  <div class="shots">${shots.map(shotFigure).join("")}</div>
  ${
		issues.length
			? `<details class="issues"><summary>${issues.length} pair${issues.length === 1 ? "" : "s"} under ${MIN_RATIO}:1</summary>
    <table>${issues
		.sort((a, b) => a.ratio - b.ratio)
		.map(
			(f) =>
				`<tr><td class="num">${f.ratio.toFixed(2)}:1</td><td>${esc(f.scheme)}</td><td>${esc(f.pair)}</td>
       <td class="chips"><span class="chip" style="background:#${esc(f.fg.replace("#", ""))}"></span><span class="chip" style="background:#${esc(f.bg.replace("#", ""))}"></span>${esc(f.fgKey)} on ${esc(f.bgKey)}</td></tr>`,
		)
		.join("")}</table></details>`
			: ""
  }
</section>`;
	};

	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Spicetify theme report</title>
<style>
:root{color-scheme:light dark;--paper:#fbfbfc;--ink:#15161b;--muted:#5f6274;--faint:#8b8e9e;--rule:#e4e5ec;
  --panel:#fff;--slate:#3d5a80;--warn:#a35a1c;--hit:#a3242b;--new:#3f6b45}
@media (prefers-color-scheme:dark){:root{--paper:#0f1014;--ink:#eceef4;--muted:#9498ab;--faint:#6e7285;
  --rule:#25272f;--panel:#161821;--slate:#8fb0d4;--warn:#e0a35f;--hit:#e4767c;--new:#7fc08c}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1500px;margin:0 auto;padding:36px 24px 80px}
figure pre{max-height:28rem;overflow:auto;font-size:12px}
.eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--faint);margin:0 0 8px}
h1{font-size:27px;margin:0 0 10px;letter-spacing:-.015em;font-weight:650}
p.lede{margin:0;color:var(--muted);max-width:78ch}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}
.summary{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 4px}
.stat{border:1px solid var(--rule);border-radius:3px;padding:10px 14px;min-width:120px;background:var(--panel)}
.stat .n{font-family:ui-monospace,Menlo,monospace;font-size:21px;display:block;font-variant-numeric:tabular-nums}
.stat .k{font-size:11.5px;color:var(--muted);display:block;margin-top:2px}
.stat.hit .n{color:var(--hit)} .stat.new .n{color:var(--new)} .stat.warn .n{color:var(--warn)}
.banner{margin:18px 0 0;padding:12px 16px;border:1px solid var(--rule);border-left:3px solid var(--slate);
  border-radius:3px;background:var(--panel);color:var(--muted);font-size:13.5px;max-width:82ch}
.theme{margin:26px 0 0;border-top:1px solid var(--rule);padding-top:16px}
.theme header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:10px}
h3{margin:0;font-size:17px;font-weight:640;font-family:ui-monospace,Menlo,monospace}
.dim{font-size:12.5px;color:var(--faint);display:flex;align-items:center;gap:6px}
.dim.warn{color:var(--warn)}
.dim.hit{color:var(--hit)}
.sw{width:11px;height:11px;border-radius:2px;border:1px solid rgba(128,128,128,.4);display:inline-block}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px}
.shots figure{margin:0;border:1px solid var(--rule);border-radius:4px;overflow:hidden;background:var(--panel)}
.shots figure.hit{border-color:var(--hit)}
.shots img{width:100%;height:auto;display:block}
.shots figcaption{padding:6px 10px 8px;font-size:11.5px;color:var(--faint);border-top:1px solid var(--rule);
  font-family:ui-monospace,Menlo,monospace;display:flex;align-items:center;gap:8px}
.badge{font-size:10px;padding:1px 6px;border-radius:2px;border:1px solid}
.badge.moved{color:var(--hit);border-color:var(--hit)}
.badge.new{color:var(--new);border-color:var(--new)}
.badge.anim{color:var(--slate);border-color:var(--slate)}
.delta{margin-left:auto;color:var(--slate);text-decoration:underline}
.issues{margin-top:10px;font-size:13px}
.issues summary{cursor:pointer;color:var(--warn);font-size:12.5px}
.issues table{border-collapse:collapse;margin-top:8px;width:100%;max-width:760px}
.issues td{padding:3px 10px 3px 0;border-bottom:1px solid var(--rule);font-size:12.5px;color:var(--muted)}
.issues .num{font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;color:var(--warn)}
.chips{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--faint)}
.chip{width:10px;height:10px;border-radius:2px;border:1px solid rgba(128,128,128,.4);display:inline-block}
a{color:inherit;text-decoration:none}
footer{margin-top:46px;padding-top:18px;border-top:1px solid var(--rule);color:var(--faint);font-size:12.5px}
</style></head><body><div class="wrap">
<p class="eyebrow">Spicetify · local</p>
<h1>Theme report</h1>
<p class="lede">${themes.length} themes captured from Spotify ${esc(live.clientVersion ?? "?")} on ${esc(capturedAt)}. Click any frame for the full PNG.</p>

<div class="summary">
  <div class="stat"><span class="n">${changes.length}</span><span class="k">frames</span></div>
  <div class="stat ${moved.length ? "hit" : ""}"><span class="n">${moved.length}</span><span class="k">changed since baseline</span></div>
  <div class="stat ${fresh.length ? "new" : ""}"><span class="n">${fresh.length}</span><span class="k">new, no baseline</span></div>
  <div class="stat ${findings.length ? "warn" : ""}"><span class="n">${findings.length}</span><span class="k">contrast issues</span></div>
  ${animated.length ? `<div class="stat"><span class="n">${animated.length}</span><span class="k">animated, not tracked</span></div>` : ""}
  <div class="stat ${unbound.length ? "hit" : ""}"><span class="n">${unbound.length}</span><span class="k">themes not binding</span></div>
</div>

${
	hasBaseline
		? moved.length
			? `<p class="banner">${moved.length} frame${moved.length === 1 ? " has" : "s have"} moved since the last accepted run. Open the delta beside a frame to see where. ${live.suite === "classmaps" ? "Inspect localized differences even when their percentage rounds to zero. Propose intentional replacements in the classmaps PR; approval and merge establish the reference." : "If the change was intended, re-run with <code>--accept</code> to make this the new baseline."}</p>`
			: `<p class="banner">Nothing moved since the last accepted run.</p>`
		: `<p class="banner">No baseline yet, so nothing could be compared. ${live.suite === "classmaps" ? "Prepare candidate PNGs with --prepare-baseline after inspecting a complete run. Approval and merge of the classmaps PR establish the reference." : "Run with <code>--accept</code> to record this run as the reference for next time."}</p>`
}

${themes.map(themeBlock).join("\n")}

${live.failures.length ? `<footer><p>${live.failures.map((f) => `${esc(f.theme)}: ${esc(f.error)}`).join("<br>")}</p></footer>` : ""}
<footer>
  ${animated.length ? `<p>Frames marked animated never stopped moving between captures, so they cannot be compared against a previous run. ${[...new Set(animated.map((c) => c.shot.theme))].map(esc).join(", ")} draw continuously.</p>` : ""}
  <p>Contrast is measured on every scheme of every theme, not just the one shown, and only on pairs the theme declares both halves of. Keys the loader backfills are its silence, not its choice.</p>
  <p>Regenerate: <code>node scripts/theme-report.ts</code>. Rebuild the page without recapturing: <code>--no-capture</code>.</p>
</footer>
</div></body></html>
`;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const flag = (n: string) => {
		const i = argv.indexOf(`--${n}`);
		return i === -1 ? undefined : argv[i + 1];
	};
	const list = (n: string) =>
		flag(n)
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	const selector = flag("selector");
	if (argv.includes("--selector") && (!selector || selector.startsWith("--"))) {
		throw new Error("--selector requires a CSS selector");
	}

	const suite = flag("suite");
	if (suite && suite !== "classmaps") throw new Error(`Unknown suite: ${suite}`);
	if (suite && argv.includes("--accept"))
		throw new Error("Classmaps baselines require PR approval and merge; use --prepare-baseline for candidates");
	if (suite && ["themes", "routes", "selector"].some((name) => flag(name)))
		throw new Error("The classmaps suite captures all seven whole-viewport states for both themes");
	if (suite && !flag("baseline-dir"))
		throw new Error("--suite classmaps requires --baseline-dir pointing at the classmaps baseline directory");
	if (!suite && flag("prepare-baseline")) throw new Error("--prepare-baseline requires --suite classmaps");
	if (flag("baseline-dir") && argv.includes("--accept"))
		throw new Error("--baseline-dir is read-only; prepare reviewed replacements instead");
	const outDir = path.resolve(flag("out") ?? path.join(REPO, "..", "scratchpad", "theme-shots"));
	const currentDir = path.join(outDir, "current");
	let baselineDir = path.resolve(flag("baseline-dir") ?? path.join(outDir, "baseline"));
	if (suite) requireOutsideGit(outDir);
	let baselineSource = `directory:${baselineDir}`;
	if (suite && argv.includes("--no-capture") && existsSync(path.join(outDir, "reference"))) {
		baselineDir = path.join(outDir, "reference");
		baselineSource = JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8")).baselineSource;
	} else if (suite) {
		const snapshot = snapshotBaseline(
			baselineDir,
			path.join(outDir, "reference"),
			flag("baseline-ref") ?? "origin/main",
		);
		baselineDir = snapshot.directory;
		baselineSource = snapshot.source;
	}
	const deltaDir = path.join(outDir, "delta");

	mkdirSync(currentDir, { recursive: true });
	rmSync(deltaDir, { recursive: true, force: true });

	let live: LiveResult;
	if (argv.includes("--no-capture")) {
		live = JSON.parse(readFileSync(path.join(outDir, "shots.json"), "utf8"));
		console.log(`reusing ${live.shots.length} frames already on disk`);
	} else {
		console.log("capturing from the live client…");
		live = suite
			? await captureClassmaps({ outDir: currentDir, port: flag("port") ? Number(flag("port")) : undefined })
			: await captureLive({
					outDir: currentDir,
					selector,
					port: flag("port") ? Number(flag("port")) : undefined,
					themes: list("themes"),
					routes: list("routes"),
					candidates: themeIds(),
					includeUnthemed: true,
				});
		writeFileSync(path.join(outDir, "shots.json"), JSON.stringify(live, null, "\t") + "\n");
		for (const f of live.failures) console.error(`  FAILED ${f.theme}: ${f.error}`);
		console.log(`  ${live.shots.length} frames, ${new Set(live.shots.map((s) => s.theme)).size} themes`);
	}

	const hasBaseline =
		existsSync(baselineDir) &&
		readdirSync(baselineDir, { recursive: true }).some((f) => String(f).endsWith(".png"));
	const expected = suite
		? classmapShots().map((shot) => live.shots.find((actual) => actual.file === shot.file) ?? shot)
		: live.shots;
	const changes = compareRun(currentDir, baselineDir, expected, deltaDir, !!suite);
	const incomplete = suite ? classmapCompleteness(live, currentDir) : [];
	if (incomplete.length) {
		for (const error of incomplete) console.error(`INCOMPLETE ${error}`);
		process.exitCode = 1;
	}

	const findings = auditAll(path.join(REPO, "themes")).findings;
	const bindings = live.selector ? [] : checkBinding(currentDir, live.shots);
	const unbound = bindings.filter((b) => !b.bound);

	writeFileSync(
		path.join(outDir, "index.html"),
		page({ changes, findings, bindings, live, capturedAt: dateStamp(), hasBaseline }),
	);
	writeFileSync(
		path.join(outDir, "report.json"),
		JSON.stringify(
			{ changes, findings, bindings, failures: live.failures, incomplete, baselineSource },
			null,
			"\t",
		) + "\n",
	);

	const moved = changes.filter((c) => c.status === "changed" || c.status === "resized");
	const animatedCount = changes.filter((c) => c.status === "animated").length;
	if (animatedCount) console.log(`animated, not tracked: ${animatedCount}`);
	console.log(`contrast: ${findings.length} pairs under ${MIN_RATIO}:1`);
	if (bindings.length) {
		const byTheme = new Map<string, number>();
		for (const b of bindings) byTheme.set(b.theme, Math.max(byTheme.get(b.theme) ?? 0, b.ratio));
		const sorted = [...byTheme].sort((a, b) => a[1] - b[1]);
		console.log(`binding (share of the bare client each theme repaints, best surface):`);
		for (const [theme, ratio] of sorted) {
			console.log(
				`  ${theme.padEnd(14)} ${(ratio * 100).toFixed(1).padStart(5)}%${ratio < BINDING_FLOOR ? "  NOT BINDING" : ""}`,
			);
		}
	}
	if (unbound.length) console.log(`not binding: ${[...new Set(unbound.map((u) => u.theme))].join(", ")}`);
	console.log(hasBaseline ? `changed since baseline: ${moved.length}` : "no baseline yet, nothing compared");
	for (const c of moved) console.log(`  ${c.shot.theme}/${c.shot.surface}: ${(c.changedRatio * 100).toFixed(2)}%`);

	if (flag("prepare-baseline")) {
		const destination = path.resolve(flag("prepare-baseline")!);
		const n = prepareClassmapBaseline(currentDir, destination, live);
		console.log(
			`Prepared ${n} candidate PNGs in ${destination}; approval and merge are required to establish baselines`,
		);
	}
	if (argv.includes("--accept")) {
		const n = accept(currentDir, baselineDir);
		console.log(`baseline updated (${n} frames)`);
	}
	const report = path.join(outDir, "index.html");
	console.log(`\nReport: ${report}`);
	if (!argv.includes("--no-open")) {
		try {
			const url = pathToFileURL(report).href;
			if (process.platform === "darwin") execFileSync("open", [url], { stdio: "ignore" });
			else if (process.platform === "win32")
				execFileSync("rundll32.exe", ["url.dll,FileProtocolHandler", url], { stdio: "ignore" });
			else execFileSync("xdg-open", [url], { stdio: "ignore", timeout: 10000 });
		} catch {
			console.error(`Could not open the report automatically. Open ${report} in your browser.`);
		}
	}
}

/** The repo's themes: a directory with a stylesheet in it is one. */
function themeIds(): string[] {
	const dir = path.join(REPO, "themes");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((t) => existsSync(path.join(dir, t, "index.css")))
		.sort();
}

/** Local date, no time zone maths, so two runs on one day read the same. */
function dateStamp(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) await main();
