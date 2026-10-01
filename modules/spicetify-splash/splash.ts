/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LOGO } from "./logo.ts";
import { getSplashImage } from "./image.ts";
import { CSS } from "./style.ts";
import { getCustomCss, getThemeSnapshot, saveThemeSnapshot } from "./theme.ts";

const DEFAULT_EXIT = 450;

export interface SplashOptions {
	/** Show the splash on demand: it stays until clicked or Escape, and never records theme styles. */
	preview?: boolean;
	/** Custom CSS to use instead of the saved custom CSS. */
	css?: string;
}

export function showSplash(options: SplashOptions = {}) {
	const customCss = options.css ?? getCustomCss();
	const styles = [CSS, getThemeSnapshot()]
		.filter((css) => css.trim())
		.map((css) => {
			const style = document.createElement("style");
			style.dataset.spicetifySplash = "";
			style.textContent = css;
			document.head.appendChild(style);
			return style;
		});
	const custom = attachCustomCss(customCss);
	const image = getSplashImage();
	const dialog = document.createElement("dialog");
	dialog.className = "spicetify-splash";
	dialog.dataset.stage = options.preview ? "loading" : "boot";
	dialog.dataset.image = image ? "custom" : "default";
	dialog.setAttribute("aria-label", "Spicetify is loading");
	dialog.innerHTML = `
		<div class="spicetify-splash__surface">
			<div class="spicetify-splash__backdrop"></div>
			<div class="spicetify-splash__content">
				<div class="spicetify-splash__logo">${image ? '<img alt="" />' : LOGO}</div>
				<div class="spicetify-splash__bar"></div>
				<p class="spicetify-splash__caption"></p>
			</div>
		</div>`;
	dialog.tabIndex = -1;
	document.body.appendChild(dialog);
	const img = dialog.querySelector("img");
	if (img && image) img.src = image;
	img?.addEventListener(
		"error",
		() => {
			dialog.querySelector(".spicetify-splash__logo")!.innerHTML = LOGO;
			dialog.dataset.image = "default";
			console.warn("[spicetify-splash] Custom image could not load; using the Spicetify logo.");
		},
		{ once: true },
	);
	dialog.showModal();
	let finished = false;
	let recordTheme = false;
	let poll: ReturnType<typeof setInterval> | undefined;
	let fade: ReturnType<typeof setTimeout> | undefined;
	const timeout = options.preview
		? undefined
		: setTimeout(() => {
				console.warn("[spicetify-splash] Startup exceeded 30 seconds; dismissing the splash.");
				finish();
			}, 30_000);

	function stopWatching() {
		clearTimeout(timeout);
		clearInterval(poll);
		dialog.removeEventListener("cancel", cancel);
		dialog.removeEventListener("click", finish);
	}

	function dispose() {
		finished = true;
		stopWatching();
		clearTimeout(fade);
		dialog.close();
		dialog.remove();
		for (const style of styles) style.remove();
		custom.remove();
		if (recordTheme) {
			recordTheme = false;
			saveThemeSnapshot(CSS, customCss);
		}
	}

	function finish() {
		if (finished) return;
		finished = true;
		stopWatching();
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			dispose();
			return;
		}
		dialog.dataset.stage = "leaving";
		fade = setTimeout(dispose, exitDuration(dialog.querySelector(".spicetify-splash__surface")!));
	}

	function cancel(event: Event) {
		event.preventDefault();
		finish();
	}

	dialog.addEventListener("cancel", cancel);
	if (options.preview) dialog.addEventListener("click", finish);
	return {
		dispose,
		watchReady(isReady: () => boolean) {
			if (finished) return;
			clearInterval(poll);
			dialog.dataset.stage = "loading";
			const check = () => {
				custom.keepLast();
				if (!isReady()) return;
				recordTheme = true;
				finish();
			};
			poll = setInterval(check, 100);
			check();
		},
	};
}

// Theme sheets are adopted, and adopted sheets cascade after every <style>,
// so custom CSS goes in an adopted sheet kept after them.
function attachCustomCss(css: string) {
	if (!css.trim()) return { keepLast() {}, remove() {} };
	const sheet = new window.CSSStyleSheet();
	sheet.replaceSync(css);
	const keepLast = () => {
		const sheets = document.adoptedStyleSheets;
		if (sheets[sheets.length - 1] !== sheet)
			document.adoptedStyleSheets = [...sheets.filter((s) => s !== sheet), sheet];
	};
	keepLast();
	return {
		keepLast,
		remove() {
			document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
		},
	};
}

function exitDuration(surface: HTMLElement): number {
	const style = window.getComputedStyle(surface);
	const seconds = (list: string) =>
		list.split(",").map((value) => Number.parseFloat(value) * (value.trim().endsWith("ms") ? 0.001 : 1) || 0);
	const durations = seconds(style.transitionDuration);
	const delays = seconds(style.transitionDelay);
	const longest = Math.max(0, ...durations.map((duration, i) => duration + (delays[i] ?? delays[0] ?? 0)));
	return longest > 0 ? Math.min(longest * 1000, 10_000) : DEFAULT_EXIT;
}
