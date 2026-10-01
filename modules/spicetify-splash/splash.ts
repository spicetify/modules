/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LOGO } from "./logo.ts";
import { getSplashImage } from "./image.ts";
import { CSS } from "./style.ts";

export function showSplash() {
	const style = document.createElement("style");
	style.dataset.spicetifySplash = "";
	style.textContent = CSS;
	document.head.appendChild(style);
	const dialog = document.createElement("dialog");
	dialog.className = "spicetify-splash";
	dialog.setAttribute("aria-label", "Spicetify is loading");
	dialog.innerHTML = `
		<div class="spicetify-splash-content">
			<img src="${getSplashImage()}" width="192" height="128" alt="" />
		</div>`;
	dialog.tabIndex = -1;
	document.body.appendChild(dialog);
	const image = dialog.querySelector("img");
	image?.addEventListener(
		"error",
		() => {
			if (image.src !== LOGO) {
				image.src = LOGO;
				console.warn("[spicetify-splash] Custom image could not load; using the Spicetify logo.");
			}
		},
		{ once: true },
	);
	dialog.showModal();
	let finished = false;
	let poll: ReturnType<typeof setInterval> | undefined;
	let fade: ReturnType<typeof setTimeout> | undefined;
	const timeout = setTimeout(() => {
		console.warn("[spicetify-splash] Startup exceeded 30 seconds; dismissing the splash.");
		finish();
	}, 30_000);

	function stopWatching() {
		clearTimeout(timeout);
		clearInterval(poll);
		dialog.removeEventListener("cancel", cancel);
	}

	function dispose() {
		finished = true;
		stopWatching();
		clearTimeout(fade);
		dialog.close();
		dialog.remove();
		style.remove();
	}

	function finish() {
		if (finished) return;
		finished = true;
		stopWatching();
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			dispose();
			return;
		}
		dialog.classList.add("spicetify-splash-leaving");
		fade = setTimeout(dispose, 180);
	}

	function cancel(event: Event) {
		event.preventDefault();
		finish();
	}

	dialog.addEventListener("cancel", cancel);
	return {
		dispose,
		watchReady(isReady: () => boolean) {
			if (finished) return;
			clearInterval(poll);
			const check = () => {
				if (isReady()) finish();
			};
			poll = setInterval(check, 100);
			check();
		},
	};
}
