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
 * a contrast audit of every scheme, and writes a page you open.
 *
 *   node scripts/theme-report.ts                  capture, compare, write
 *   node scripts/theme-report.ts --accept         make this run the baseline
 *   node scripts/theme-report.ts --no-capture     rebuild the page from disk
 *   node scripts/theme-report.ts --themes flow    just one
 *   node scripts/theme-report.ts --routes /       just one route
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

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
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

export interface LiveShot {
	theme: string;
	scheme: string | null;
	route: string;
	surface: string;
	file: string;
	/** The resolved --spice-main, proof the frame is the theme it claims. */
	main: string;
	/** False when the surface never stopped moving, so it animates. */
	stable: boolean;
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
}

/** Minimal CDP client: one socket, request/response by id. */
export class Cdp {
	private ws!: WebSocket;
	private id = 0;
	private pending = new Map<number, (v: unknown) => void>();

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
				cdp.pending.get(m.id)!(m.result ?? m.error);
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
		return new Promise((resolve) => {
			this.pending.set(id, resolve as (v: unknown) => void);
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
	async shootStable(file: string, tries = 8, gapMs = 300): Promise<boolean> {
		let previous: Buffer | null = null;
		for (let i = 0; i < tries; i++) {
			const shot = await this.call("Page.captureScreenshot", { format: "png" });
			const current = Buffer.from(shot.data, "base64");
			if (previous) {
				const drift = comparePng(previous, current);
				if (!drift.mismatch && drift.changedRatio <= STABLE_EPSILON) {
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
	const routes = opts.routes?.length ? opts.routes : Object.keys(ROUTES);
	const shots: LiveShot[] = [];
	const failures: LiveFailure[] = [];

	const clientVersion = await cdp.eval<string | null>(`return window.Spicetify?.Platform?.version ?? null;`);

	const known = await cdp.eval<{ installed: string[]; active: string | null; scheme: string | null }>(`
    const active = localStorage.getItem("spicetify:modules:activeTheme");
    return {
      installed: window.Spicetify.Modules.list().map((m) => m.identifier),
      active,
      scheme: active ? localStorage.getItem("spicetify:scheme:" + active) : null,
    };`);

	const installed = new Set(known.installed);
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
			const stable = await cdp.shootStable(file);
			shots.push({ theme: label, scheme, route, surface, file: path.basename(file), main, stable });
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

	return { shots, failures, restored: restoreTo, clientVersion };
}

/* ----------------------------------------- Report: comparison, binding, page */

export type ChangeStatus = "new" | "changed" | "same" | "resized" | "animated";

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

export function compareRun(currentDir: string, baselineDir: string, shots: LiveShot[], deltaDir: string): ShotChange[] {
	return shots.map((shot) => {
		const current = path.join(currentDir, shot.file);
		const baseline = path.join(baselineDir, shot.file);
		if (!existsSync(baseline)) return { shot, status: "new", changedPixels: 0, changedRatio: 0 };

		const result = comparePng(readFileSync(baseline), readFileSync(current));
		if (result.mismatch) return { shot, status: "resized", changedPixels: 0, changedRatio: 1 };

		// A surface that never stopped moving is animating, and an animation
		// differs from its own last frame by definition. Calling that a change
		// every run is how a tracking tool teaches its reader to ignore it.
		if (!shot.stable) {
			return { shot, status: "animated", changedPixels: result.changedPixels, changedRatio: result.changedRatio };
		}

		if (result.changedRatio <= CHANGE_RATIO) {
			return { shot, status: "same", changedPixels: result.changedPixels, changedRatio: result.changedRatio };
		}

		mkdirSync(deltaDir, { recursive: true });
		const deltaFile = path.join(deltaDir, shot.file);
		if (result.delta) writeFileSync(deltaFile, result.delta);
		return {
			shot,
			status: "changed",
			changedPixels: result.changedPixels,
			changedRatio: result.changedRatio,
			deltaFile: path.basename(deltaFile),
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
	const bare = new Map(shots.filter((s) => s.theme === UNTHEMED).map((s) => [s.surface, s.file]));
	const rows: Binding[] = [];
	for (const shot of shots) {
		if (shot.theme === UNTHEMED) continue;
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
		if (c.status === "new") return '<span class="badge new">new</span>';
		if (c.status === "animated") return '<span class="badge anim">animated</span>';
		if (c.status === "resized") return '<span class="badge moved">size changed</span>';
		return `<span class="badge moved">${(c.changedRatio * 100).toFixed(2)}% moved</span>`;
	};

	const shotFigure = (
		c: ShotChange,
	) => `<figure${c.status === "changed" || c.status === "resized" ? ' class="hit"' : ""}>
  <a href="current/${encodeURIComponent(c.shot.file)}"><img src="current/${encodeURIComponent(c.shot.file)}" alt="${esc(c.shot.theme)} ${esc(c.shot.surface)}" loading="lazy"></a>
  <figcaption>${esc(c.shot.surface)}${badge(c)}${c.deltaFile ? ` <a class="delta" href="delta/${encodeURIComponent(c.deltaFile)}">delta</a>` : ""}</figcaption>
</figure>`;

	const themeBlock = (theme: string) => {
		const shots = byTheme.get(theme) ?? [];
		const first = shots[0]?.shot;
		const issues = findingsByTheme.get(theme) ?? [];
		const worst = issues.length ? Math.min(...issues.map((f) => f.ratio)) : null;
		return `<section class="theme" id="theme-${esc(theme)}">
  <header>
    <h3>${esc(theme)}</h3>
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
			? `<p class="banner">${moved.length} frame${moved.length === 1 ? " has" : "s have"} moved since the last accepted run. Open the delta beside a frame to see where. If the change was intended, re-run with <code>--accept</code> to make this the new baseline.</p>`
			: `<p class="banner">Nothing moved since the last accepted run.</p>`
		: `<p class="banner">No baseline yet, so nothing could be compared. Run with <code>--accept</code> to record this run as the reference for next time.</p>`
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

	const outDir = path.resolve(flag("out") ?? path.join(REPO, "..", "scratchpad", "theme-shots"));
	const currentDir = path.join(outDir, "current");
	const baselineDir = path.join(outDir, "baseline");
	const deltaDir = path.join(outDir, "delta");

	mkdirSync(currentDir, { recursive: true });
	rmSync(deltaDir, { recursive: true, force: true });

	let live: LiveResult;
	if (argv.includes("--no-capture")) {
		live = JSON.parse(readFileSync(path.join(outDir, "shots.json"), "utf8"));
		console.log(`reusing ${live.shots.length} frames already on disk`);
	} else {
		console.log("capturing from the live client…");
		live = await captureLive({
			outDir: currentDir,
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

	const hasBaseline = existsSync(baselineDir) && readdirSync(baselineDir).some((f) => f.endsWith(".png"));
	const changes = hasBaseline
		? compareRun(currentDir, baselineDir, live.shots, deltaDir)
		: live.shots.map((shot) => ({ shot, status: "new" as const, changedPixels: 0, changedRatio: 0 }));

	const findings = auditAll(path.join(REPO, "themes")).findings;
	const bindings = checkBinding(currentDir, live.shots);
	const unbound = bindings.filter((b) => !b.bound);

	writeFileSync(
		path.join(outDir, "index.html"),
		page({ changes, findings, bindings, live, capturedAt: dateStamp(), hasBaseline }),
	);
	writeFileSync(
		path.join(outDir, "report.json"),
		JSON.stringify({ changes, findings, bindings, failures: live.failures }, null, "\t") + "\n",
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

	if (argv.includes("--accept")) {
		const n = accept(currentDir, baselineDir);
		console.log(`baseline updated (${n} frames)`);
	}
	console.log(`\nopen ${path.join(outDir, "index.html")}`);
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
