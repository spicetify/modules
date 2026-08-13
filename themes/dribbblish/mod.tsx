/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Dribbblish" theme by
 * khanhas and harbassan.
 *
 * The classic script branched on client_version_int: everything below
 * 1.21.4 took a "legacy" path (navbar/buddy-feed resizers, playlist-image
 * rendering, folder-image context menus) that cannot run on a v3 client.
 * Only the modern branch survives here.
 */

import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

import {
	captureInlineStyles,
	floatingSearchLayout,
	mirrorRailButton,
	navlinkRailLayout,
	relocateElement,
	removeStaleRailMirrors,
	restoreInlineStyles,
	SEARCH_HOST_CLASS,
	SEARCH_HOST_OPEN_CLASS,
	syncSearchHostClasses,
} from "./logic.ts";

// Horizontal padding the tooltip keeps from either end of the progress bar.
const TOOLTIP_EDGE_GAP = 12;
const HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE = "data-spicetify-hide-window-controls-required";

export default async function (ctx: ModuleRuntimeContext) {
	let disposed = false;
	const timers = new Set<number>();
	const setT = (fn: () => void, ms: number) => {
		const id = window.setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
	};

	// Bounded: the loader awaits this function, so a selector that never
	// resolves must give up rather than hang every other module.
	const waitFor = <T extends Element>(selector: string, tries = 20) =>
		new Promise<T | null>((resolve) => {
			let left = tries;
			const attempt = () => {
				if (disposed) return resolve(null);
				const found = document.querySelector<T>(selector);
				if (found) return resolve(found);
				if (--left <= 0) return resolve(null);
				setT(attempt, 250);
			};
			attempt();
		});

	ctx.defer(() => {
		disposed = true;
		for (const id of timers) clearTimeout(id);
		timers.clear();
	});

	// Dribbblish uses the native title-bar space as part of its green rail.
	// The dependency watches this marker and keeps the native controls hidden
	// while the theme is active, without overwriting the user's saved choice.
	document.documentElement.setAttribute(HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE, "");
	ctx.defer(() => document.documentElement.removeAttribute(HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE));

	// The stylesheet scopes its layout rules to the client generation.
	document.documentElement.classList.add("ylx");
	ctx.defer(() => document.documentElement.classList.remove("ylx"));

	const topContainer = await waitFor<HTMLElement>(".Root__top-container");
	if (disposed) return;
	if (topContainer) {
		const shadow = document.createElement("div");
		shadow.id = "dribbblish-back-shadow";
		topContainer.prepend(shadow);
		ctx.defer(() => shadow.remove());
	}

	// The top bar is inset by the left sidebar's width, which the user can
	// drag. Mirror it onto the global nav as a unitless custom property.
	const [sidebar, globalNav, navlinks, homeButton, searchSection] = await Promise.all([
		waitFor<HTMLElement>(".Root__nav-bar, #Desktop_LeftSidebar_Id"),
		waitFor<HTMLElement>(".Root__globalNav"),
		waitFor<HTMLElement>(".spicetify-navlinks-anchor"),
		waitFor<HTMLButtonElement>('[data-testid="home-button"]'),
		waitFor<HTMLElement>(".main-globalNav-searchSection"),
	]);
	if (disposed) return;
	if (topContainer && sidebar && globalNav) {
		const syncWidth = () => {
			const declared = Number(getComputedStyle(sidebar).getPropertyValue("--left-sidebar-width").trim());
			const width = declared || sidebar.clientWidth;
			globalNav.style.setProperty("--left-sidebar-width", String(width));
			topContainer.style.setProperty("--dribbblish-sidebar-width", `${width}px`);
		};
		const observer = new ResizeObserver(syncWidth);
		observer.observe(sidebar);
		syncWidth();
		ctx.defer(() => {
			observer.disconnect();
			globalNav.style.removeProperty("--left-sidebar-width");
			topContainer.style.removeProperty("--dribbblish-sidebar-width");
		});
	}

	if (topContainer && navlinks) {
		const rail = document.createElement("div");
		rail.id = "dribbblish-navlinks-rail";
		topContainer.append(rail);
		const restoreNavlinks = relocateElement(navlinks, rail);
		removeStaleRailMirrors(navlinks);
		const mirroredButtons = new Map<HTMLButtonElement, ReturnType<typeof mirrorRailButton>>();
		const syncMirroredButtons = () => {
			for (const [source, mirror] of mirroredButtons) {
				if (source.isConnected) continue;
				mirror.dispose();
				mirroredButtons.delete(source);
			}
			for (const source of navlinks.querySelectorAll<HTMLButtonElement>(".inline-flex > button")) {
				if (
					source.closest(".dribbblish-native-navlink") ||
					source.classList.contains("dribbblish-rail-button") ||
					source.hasAttribute("data-dribbblish-rail-source")
				)
					continue;
				mirroredButtons.set(source, mirrorRailButton(source));
			}
		};
		syncMirroredButtons();

		let searchButton: HTMLButtonElement | undefined;
		let closeSearch: (() => void) | undefined;
		let repositionSearch: (() => void) | undefined;
		let removeSearchListeners: (() => void) | undefined;

		if (homeButton && searchSection && globalNav) {
			const homeItem = document.createElement("div");
			homeItem.className = "inline-flex dribbblish-native-navlink";
			const railHomeButton = homeButton.cloneNode(true) as HTMLButtonElement;
			railHomeButton.id = "dribbblish-home-button";
			railHomeButton.removeAttribute("data-testid");
			railHomeButton.removeAttribute("aria-current");
			homeItem.append(railHomeButton);
			navlinks.prepend(homeItem);

			const nativeSearchIcon = searchSection.querySelector<HTMLElement>('[data-testid="search-icon"] span');
			searchButton = homeButton.cloneNode(false) as HTMLButtonElement;
			searchButton.id = "dribbblish-search-button";
			searchButton.removeAttribute("data-testid");
			searchButton.removeAttribute("aria-current");
			searchButton.setAttribute("aria-label", "Search");
			searchButton.setAttribute("aria-controls", "dribbblish-search-host");
			searchButton.setAttribute("aria-expanded", "false");
			if (nativeSearchIcon) searchButton.append(nativeSearchIcon.cloneNode(true));

			const searchItem = document.createElement("div");
			searchItem.className = "inline-flex dribbblish-native-navlink";
			searchItem.append(searchButton);
			homeItem.after(searchItem);

			let searchOpen = false;
			let currentSearchHost: HTMLElement | null = null;
			const knownSearchHosts = new Map<
				HTMLElement,
				{ id: string | null; styles: ReturnType<typeof captureInlineStyles> }
			>();
			const cleanSearchHost = (host: HTMLElement) => {
				host.classList.remove(SEARCH_HOST_CLASS, SEARCH_HOST_OPEN_CLASS);
				const original = knownSearchHosts.get(host);
				if (!original) return;
				restoreInlineStyles(host, original.styles);
				if (original.id === null) host.removeAttribute("id");
				else host.id = original.id;
			};
			const syncSearchHost = () => {
				const next = document.querySelector<HTMLElement>(".main-globalNav-searchSection");
				if (currentSearchHost !== next) {
					if (currentSearchHost) cleanSearchHost(currentSearchHost);
					if (next) {
						if (!knownSearchHosts.has(next)) {
							knownSearchHosts.set(next, {
								id: next.getAttribute("id"),
								styles: captureInlineStyles(next, ["left", "top", "width"]),
							});
						}
						next.id = "dribbblish-search-host";
					}
				}
				currentSearchHost = syncSearchHostClasses(currentSearchHost, next, searchOpen);
				return currentSearchHost;
			};
			syncSearchHost();

			closeSearch = () => {
				if (!searchButton) return;
				searchOpen = false;
				const host = syncSearchHost();
				host?.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.blur();
				searchButton.setAttribute("aria-expanded", "false");
			};
			repositionSearch = () => {
				if (!searchButton) return;
				const host = syncSearchHost();
				if (!host) return;
				const layout = floatingSearchLayout(
					searchButton.getBoundingClientRect(),
					rail.getBoundingClientRect(),
					window.innerWidth,
				);
				host.style.left = `${layout.left}px`;
				host.style.top = `${layout.top}px`;
				host.style.width = `${layout.width}px`;
			};
			const openSearch = () => {
				if (!searchButton) return;
				searchOpen = true;
				searchButton.setAttribute("aria-expanded", "true");
				const host = syncSearchHost();
				if (!host) return;
				repositionSearch?.();
				host.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus();
			};
			const toggleSearch = () => (searchOpen ? closeSearch?.() : openSearch());
			const onDocumentPointerDown = (event: PointerEvent) => {
				const target = event.target as Node | null;
				if (target && !currentSearchHost?.contains(target) && !searchButton?.contains(target)) closeSearch?.();
			};
			const onDocumentKeyDown = (event: KeyboardEvent) => {
				if (event.key === "Escape") closeSearch?.();
				if (event.key === "Enter" && currentSearchHost?.contains(event.target as Node))
					setT(() => closeSearch?.(), 0);
			};
			const onWindowResize = () => {
				if (searchOpen) repositionSearch?.();
			};
			const searchHostObserver = new MutationObserver(() => {
				const previous = currentSearchHost;
				const host = syncSearchHost();
				if (searchOpen && host !== previous) {
					repositionSearch?.();
					host?.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus();
				}
			});
			searchHostObserver.observe(globalNav, { childList: true, subtree: true });
			railHomeButton.addEventListener("click", () => Spicetify.Platform.History.push("/"));
			searchButton.addEventListener("click", toggleSearch);
			document.addEventListener("pointerdown", onDocumentPointerDown);
			document.addEventListener("keydown", onDocumentKeyDown, true);
			window.addEventListener("resize", onWindowResize);
			removeSearchListeners = () => {
				searchHostObserver.disconnect();
				searchButton?.removeEventListener("click", toggleSearch);
				document.removeEventListener("pointerdown", onDocumentPointerDown);
				document.removeEventListener("keydown", onDocumentKeyDown, true);
				window.removeEventListener("resize", onWindowResize);
				for (const host of knownSearchHosts.keys()) cleanSearchHost(host);
			};
		}

		const syncRailLayout = () => {
			syncMirroredButtons();
			const count = rail.querySelectorAll("button:not([data-dribbblish-rail-source])").length;
			const { expanded, reserve } = navlinkRailLayout(rail.clientWidth, count);
			rail.classList.toggle("dribbblish-navlinks-rail--expanded", expanded);
			topContainer.style.setProperty("--dribbblish-navlinks-reserve", `${reserve}px`);
			repositionSearch?.();
		};
		const railObserver = new MutationObserver(syncRailLayout);
		railObserver.observe(rail, { childList: true, subtree: true });
		const railResizeObserver = new ResizeObserver(syncRailLayout);
		railResizeObserver.observe(rail);
		syncRailLayout();

		ctx.defer(() => {
			railObserver.disconnect();
			railResizeObserver.disconnect();
			topContainer.style.removeProperty("--dribbblish-navlinks-reserve");
			closeSearch?.();
			removeSearchListeners?.();
			for (const mirror of mirroredButtons.values()) mirror.dispose();
			mirroredButtons.clear();
			navlinks.querySelectorAll(".dribbblish-native-navlink").forEach((item) => item.remove());
			restoreNavlinks();
			rail.remove();
		});
	}

	// Playback time follows the cursor along the progress bar on hover.
	const progressBar = await waitFor<HTMLElement>(".playback-bar");
	if (!progressBar || disposed) return;
	const tooltip = document.createElement("div");
	tooltip.className = "prog-tooltip";
	progressBar.append(tooltip);

	const updateTooltip = () => {
		const maxWidth = progressBar.offsetWidth;
		const played = Spicetify.Player.getProgressPercent() * maxWidth;
		const halfTooltip = tooltip.offsetWidth / 2;
		if (played < halfTooltip + TOOLTIP_EDGE_GAP) {
			tooltip.style.left = `${TOOLTIP_EDGE_GAP}px`;
		} else if (played > maxWidth - halfTooltip - TOOLTIP_EDGE_GAP) {
			tooltip.style.left = `${maxWidth - halfTooltip * 2 - TOOLTIP_EDGE_GAP}px`;
		} else {
			tooltip.style.left = `${played - halfTooltip}px`;
		}
		const { formatTime, getProgress, getDuration } = Spicetify.Player;
		tooltip.innerText = `${formatTime(getProgress())} / ${formatTime(getDuration())}`;
	};

	Spicetify.Player.addEventListener("onprogress", updateTooltip);
	updateTooltip();
	ctx.defer(() => {
		Spicetify.Player.removeEventListener("onprogress", updateTooltip);
		tooltip.remove();
	});
}
