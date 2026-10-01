/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const CSS_KEY = "spicetify:splash:css";
const SNAPSHOT_KEY = "spicetify:splash:theme";
const MAX_CSS = 32 * 1024;
const MAX_SNAPSHOT = 64 * 1024;
const SELECTOR = "spicetify-splash";
const STYLE_RULE = 1;
const IMPORT_RULE = 3;
const KEYFRAMES_RULE = 7;

export function getCustomCss(): string {
	const css = localStorage.getItem(CSS_KEY) ?? "";
	return css.length <= MAX_CSS ? css : "";
}

export function saveCustomCss(css: string): void {
	if (css.length > MAX_CSS) throw new Error("Keep custom CSS under 32 KB.");
	if (css.trim()) localStorage.setItem(CSS_KEY, css);
	else localStorage.removeItem(CSS_KEY);
}

export function getThemeSnapshot(): string {
	const css = localStorage.getItem(SNAPSHOT_KEY) ?? "";
	return css.length <= MAX_SNAPSHOT ? css : "";
}

// Theme stylesheets are adopted after Spotify boots, long after the splash
// first paints. Saving the splash rules they contain, the keyframes those
// rules animate with, and the resolved custom properties they read lets the
// next startup paint the themed splash from its first frame. The properties
// sit on :root in the lowest layer, so the live theme replaces them once it
// loads, and the rules sit in a layer above the defaults but below custom CSS.
// Call it with no splash styles attached, so earlier snapshots and custom CSS
// do not feed back into the saved values.
export function saveThemeSnapshot(baseCss: string, customCss: string): void {
	const keyframes = new Map<string, CSSKeyframesRule>();
	let rules = "";
	for (const sheet of [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? [])]) {
		rules += pickRules(sheet, keyframes);
	}
	const animated = new Set<string>();
	for (const [, value] of `${rules}${customCss}`.matchAll(/animation(?:-name)?\s*:([^;}]+)/g)) {
		for (const name of value.split(/[\s,]+/)) animated.add(name);
	}
	let motion = "";
	for (const name of animated) motion += keyframes.get(name)?.cssText ?? "";
	const root = window.getComputedStyle(document.documentElement);
	let properties = "";
	for (const name of new Set(`${baseCss}${customCss}${rules}`.match(/--(?!_)[\w-]+/g))) {
		const value = root.getPropertyValue(name).trim();
		if (value) properties += `${name}:${value};`;
	}
	const snapshot =
		(properties ? `@layer spicetify-splash{:root{${properties}}}` : "") +
		(rules ? `@layer spicetify-splash-theme{${motion}${rules}}` : "");
	try {
		if (!snapshot) localStorage.removeItem(SNAPSHOT_KEY);
		else if (snapshot.length <= MAX_SNAPSHOT) localStorage.setItem(SNAPSHOT_KEY, snapshot);
		else {
			localStorage.removeItem(SNAPSHOT_KEY);
			console.warn("[spicetify-splash] Theme splash styles exceed 64 KB; they apply once the theme loads.");
		}
	} catch (error) {
		console.warn("[spicetify-splash] Could not save the theme's splash styles.", error);
	}
}

function pickRules(sheet: CSSStyleSheet, keyframes: Map<string, CSSKeyframesRule>): string {
	let rules: CSSRuleList;
	try {
		rules = sheet.cssRules;
	} catch {
		return "";
	}
	return pickFrom(rules, keyframes, sheet.href);
}

function pickFrom(rules: CSSRuleList, keyframes: Map<string, CSSKeyframesRule>, base: string | null): string {
	let css = "";
	for (const rule of Array.from(rules)) {
		if (rule.type === STYLE_RULE) {
			if ((rule as CSSStyleRule).selectorText.includes(SELECTOR)) css += absolutize(rule.cssText, base);
		} else if (rule.type === KEYFRAMES_RULE) {
			keyframes.set((rule as CSSKeyframesRule).name, rule as CSSKeyframesRule);
		} else if (rule.type === IMPORT_RULE) {
			const imported = (rule as CSSImportRule).styleSheet;
			if (imported) css += pickRules(imported, keyframes);
		} else if ("cssRules" in rule) {
			const inner = pickFrom((rule as CSSGroupingRule).cssRules, keyframes, base);
			if (inner) css += `${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${inner}}`;
		}
	}
	return css;
}

// Replayed rules live in an inline <style>, so relative url()s must be
// resolved against the stylesheet they came from.
function absolutize(css: string, base: string | null): string {
	if (!base) return css;
	return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, url: string) =>
		/^(?:[a-z][\w+.-]*:|\/|#)/i.test(url) ? match : `url("${new URL(url, base).href}")`,
	);
}
