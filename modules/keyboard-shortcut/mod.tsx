/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Keyboard Shortcut"
 * extension by khanhas and OhItsTom. The client's v2-compatible Mousetrap,
 * Keyboard, Player, Platform and CosmosAsync helpers still work in v3, so the
 * shortcut logic is kept near-verbatim; the runtime <style> the vim overlay
 * injected now lives in index.scss (scoped under #vim-overlay), and every
 * binding, listener, interval and DOM node is torn down in ctx.defer.
 */

import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

const SCROLL_STEP = 25;

interface Bind {
	staticCondition?: boolean;
	callback: (event: KeyboardEvent) => void;
}

interface VimBind {
	readonly isActive: boolean;
	activate(event?: KeyboardEvent): void;
	deactivate(event?: KeyboardEvent): void;
	setCancelKey(key: string): void;
	destroy(): void;
}

function createVimBind(): VimBind {
	const elementQuery = ["[href]", "button", ".main-trackList-trackListRow", "[role='button']"].join(",");
	const keyList = "qwertasdfgzxcvyuiophjklbnm".split("");
	const lastKeyIndex = keyList.length - 1;

	let isActive = false;

	const vimOverlay = document.createElement("div");
	const baseOverlay = document.createElement("div");
	const tippyOverlay = document.createElement("div");
	vimOverlay.id = "vim-overlay";
	baseOverlay.id = "base-overlay";
	tippyOverlay.id = "tippy-overlay";
	vimOverlay.style.position = baseOverlay.style.position = tippyOverlay.style.position = "absolute";
	vimOverlay.style.width = baseOverlay.style.width = tippyOverlay.style.width = "100%";
	vimOverlay.style.height = baseOverlay.style.height = tippyOverlay.style.height = "100%";
	baseOverlay.style.zIndex = "9999";
	tippyOverlay.style.zIndex = "10000";
	vimOverlay.style.display = "none";
	vimOverlay.append(baseOverlay);
	vimOverlay.append(tippyOverlay);
	document.body.append(vimOverlay);

	const mousetrap = new Spicetify.Mousetrap(document);
	mousetrap.bind(keyList, listenToKeys, "keypress");
	// Pause mousetrap event emitter until the overlay is activated.
	const orgStopCallback = mousetrap.stopCallback;
	mousetrap.stopCallback = () => true;

	function getLinks(): Element[] {
		return Array.from(document.querySelectorAll(elementQuery));
	}

	function getVims(): HTMLElement[] {
		return Array.from(vimOverlay.getElementsByClassName("vim-key")) as HTMLElement[];
	}

	function activate() {
		vimOverlay.style.display = "block";

		for (const e of getVims()) {
			e.remove();
		}

		let firstKey = 0;
		let secondKey = 0;

		for (const e of getLinks()) {
			const computed = window.getComputedStyle(e);
			if (computed.display === "none" || computed.visibility === "hidden" || computed.opacity === "0") {
				continue;
			}

			const bound = e.getBoundingClientRect();
			const owner = document.body;

			let top = bound.top;
			let left = bound.left;

			if (
				bound.bottom > owner.clientHeight ||
				bound.left > owner.clientWidth ||
				bound.right < 0 ||
				bound.top < 0 ||
				bound.width === 0 ||
				bound.height === 0
			) {
				continue;
			}

			// Exclude certain elements from the centering calculation
			if ((e.parentNode as any)?.role !== "row") {
				top = top + bound.height / 2 - 15;
				left = left + bound.width / 2 - 15;
			}

			// Append the key to the correct overlay
			if (e.tagName === "BUTTON" && (e.parentNode as any)?.tagName === "LI") {
				tippyOverlay.append(createKey(e, keyList[firstKey] + keyList[secondKey], top, left));
			} else {
				baseOverlay.append(createKey(e, keyList[firstKey] + keyList[secondKey], top, left));
			}

			secondKey++;
			if (secondKey > lastKeyIndex) {
				secondKey = 0;
				firstKey++;
			}
		}

		isActive = true;
		setTimeout(() => {
			mousetrap.stopCallback = orgStopCallback.bind(mousetrap);
		}, 100);
	}

	function deactivate() {
		mousetrap.stopCallback = () => true;
		isActive = false;
		vimOverlay.style.display = "none";
		for (const e of getVims()) {
			e.remove();
		}
	}

	function listenToKeys(event: KeyboardEvent) {
		if (!isActive) {
			return;
		}

		const vimkey = getVims();

		if (vimkey.length === 0) {
			deactivate();
			return;
		}

		for (const div of vimkey) {
			const text = div.innerText.toLowerCase();
			if (text[0] !== event.key) {
				div.remove();
				continue;
			}

			const newText = text.slice(1);
			if (newText.length === 0) {
				interact((div as any).target);
				deactivate();
				return;
			}

			div.innerText = newText;
		}

		if (baseOverlay.childNodes.length === 0 && tippyOverlay.childNodes.length === 0) {
			deactivate();
		}
	}

	function interact(element: any) {
		// Hover on contextmenu dropdown list items
		if (element.tagName === "BUTTON" && element.parentNode.tagName === "LI" && element.ariaExpanded !== null) {
			const event = new MouseEvent("mouseover", {
				view: window,
				bubbles: true,
				cancelable: true,
			});

			element.dispatchEvent(event);
			return;
		}

		if (
			element.hasAttribute("href") ||
			element.tagName === "BUTTON" ||
			element.role === "button" ||
			element.parentNode.role === "row"
		) {
			element.click();
			return;
		}

		const findButton =
			element.querySelector(`button[data-ta-id="play-button"]`) ||
			element.querySelector(`button[data-button="play"]`);
		if (findButton instanceof HTMLButtonElement) {
			findButton.click();
			return;
		}
		alert("Let me know where you found this button, please. I can't click this for you without that information.");
	}

	function createKey(target: Element, key: string, top: number, left: number): HTMLSpanElement {
		const div = document.createElement("span");
		div.classList.add("vim-key");
		div.innerText = key;
		div.style.top = `${top}px`;
		div.style.left = `${left}px`;
		(div as any).target = target;
		return div;
	}

	function setCancelKey(key: string) {
		mousetrap.bind(Spicetify.Keyboard.KEYS[key as Spicetify.Keyboard.ValidKey], () => deactivate());
	}

	function destroy() {
		mousetrap.reset();
		vimOverlay.remove();
	}

	return {
		get isActive() {
			return isActive;
		},
		activate,
		deactivate,
		setCancelKey,
		destroy,
	};
}

export default async function (ctx: ModuleRuntimeContext) {
	const vim = createVimBind();

	// Track scroll intervals so an unload mid-scroll cannot leak them.
	const scrollIntervals = new Set<ReturnType<typeof setInterval>>();
	// Aborts any keyup listeners still pending from a held j/k at unload.
	const scrollKeyupController = new AbortController();

	function focusOnApp(): HTMLElement | null {
		return document.querySelector(
			".Root__main-view .os-viewport, .Root__main-view .main-view-container > .main-view-container__scroll-node:not([data-overlayscrollbars-initialize]), .Root__main-view .main-view-container__scroll-node > [data-overlayscrollbars-viewport]",
		);
	}

	function createScrollCallback(step: number) {
		const app = focusOnApp();
		if (app) {
			const scrollInterval = setInterval(() => {
				app.scrollTop += step;
			}, 10);
			scrollIntervals.add(scrollInterval);
			document.addEventListener(
				"keyup",
				() => {
					clearInterval(scrollInterval);
					scrollIntervals.delete(scrollInterval);
				},
				{ once: true, signal: scrollKeyupController.signal },
			);
		}
	}

	function scrollToPosition(position: number) {
		const app = focusOnApp();
		app?.scroll(0, position === 0 ? 0 : app.scrollHeight);
	}

	function findActiveIndex(allItems: NodeListOf<Element>): number {
		const activeLink = document.querySelector(".main-yourLibraryX-navLinkActive");
		const historyURI = Spicetify.Platform.History.location.pathname.replace(/^\//, "spotify:").replace(/\//g, ":");
		const activePage = document.querySelector(`[aria-describedby="onClickHint${historyURI}"]`);

		if (!activeLink && !activePage) {
			return -1;
		}

		let index = 0;
		for (const item of allItems) {
			if (item === activeLink || item === activePage) {
				return index;
			}
			index++;
		}
		return -1;
	}

	function rotateSidebar(direction: 1 | -1) {
		const allItems = document.querySelectorAll<HTMLElement>(
			"#spicetify-sticky-list .main-yourLibraryX-navLink, .main-yourLibraryX-listItem > div:not(:has([data-skip-in-keyboard-nav])) > div:first-child",
		);
		const maxIndex = allItems.length - 1;

		let index = findActiveIndex(allItems) + direction;
		if (index < 0) index = maxIndex;
		else if (index > maxIndex) index = 0;

		allItems[index]?.click();
	}

	const binds: Record<string, Bind> = {
		// Shutdown Spotify using Ctrl+Q
		"ctrl+q": {
			callback: () =>
				Spicetify.CosmosAsync.post(
					"sp://esperanto/spotify.desktop.lifecycle_esperanto.proto.DesktopLifecycle/Shutdown",
				) && Spicetify.CosmosAsync.post("sp://desktop/v1/shutdown"),
		},

		// Rotate through sidebar items using Ctrl+Tab and Ctrl+Shift+Tab
		"ctrl+tab": { callback: () => rotateSidebar(1) },
		"ctrl+shift+tab": { callback: () => rotateSidebar(-1) },

		// Focus on the app content before scrolling using Shift+PageUp and Shift+PageDown
		"shift+pageup": { callback: () => focusOnApp() },
		"shift+pagedown": { callback: () => focusOnApp() },

		// Scroll actions using 'j' and 'k' keys
		j: { callback: () => createScrollCallback(SCROLL_STEP) },
		k: { callback: () => createScrollCallback(-SCROLL_STEP) },

		// Scroll to the top ('gg') or bottom ('Shift+g') of the page
		"g g": { callback: () => scrollToPosition(0) },
		"shift+g": { callback: () => scrollToPosition(1) },

		// Shift + H and Shift + L to go back and forward page
		"shift+h": { callback: () => Spicetify.Platform.History.goBack() },
		"shift+l": { callback: () => Spicetify.Platform.History.goForward() },

		// M to Like/Unlike track
		m: { callback: () => Spicetify.Player.toggleHeart() },

		// Forward Slash to open search page
		"/": { callback: () => Spicetify.Platform.History.replace("/search") },

		// CTRL + Arrow Left Previous, CTRL + Arrow Right Next Song
		"ctrl+left": { callback: () => Spicetify.Player.back() },
		"ctrl+right": { callback: () => Spicetify.Player.next() },

		// CTRL + Arrow Up Increase Volume, CTRL + Arrow Down Decrease Volume
		"ctrl+up": { callback: () => Spicetify.Player.setVolume(Spicetify.Player.getVolume() + 0.05) },
		"ctrl+down": { callback: () => Spicetify.Player.setVolume(Spicetify.Player.getVolume() - 0.05) },

		// Activate Vim mode and set cancel key to 'ESCAPE'
		f: {
			callback: (event) => {
				vim.activate(event);
				vim.setCancelKey("ESCAPE");
			},
		},
	};

	// Bind all the keys
	const boundKeys: string[] = [];
	for (const [key, { staticCondition, callback }] of Object.entries(binds)) {
		if (typeof staticCondition === "undefined" || staticCondition) {
			Spicetify.Mousetrap.bind(key, (event: KeyboardEvent) => {
				event.preventDefault();
				if (!vim.isActive) {
					callback(event);
				}
			});
			boundKeys.push(key);
		}
	}

	// re-render vim on window resize & prevent mouse event while active
	const onResize = () => {
		if (vim.isActive) {
			vim.activate();
		}
	};
	const onMouseDown = (event: MouseEvent) => {
		if (vim.isActive) {
			event.stopPropagation();
		}
	};
	window.addEventListener("resize", onResize, true);
	window.addEventListener("mousedown", onMouseDown, true);

	ctx.defer(() => {
		for (const key of boundKeys) {
			Spicetify.Mousetrap.unbind(key);
		}
		window.removeEventListener("resize", onResize, true);
		window.removeEventListener("mousedown", onMouseDown, true);
		for (const interval of scrollIntervals) {
			clearInterval(interval);
		}
		scrollIntervals.clear();
		scrollKeyupController.abort();
		vim.destroy();
	});
}
