/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../modules/stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
	captureInlineStyles,
	floatingSearchLayout,
	mirrorRailButton,
	navlinkRailLayout,
	railTooltipPosition,
	relocateElement,
	removeStaleRailMirrors,
	restoreInlineStyles,
	SEARCH_HOST_CLASS,
	SEARCH_HOST_OPEN_CLASS,
	syncSearchHostClasses,
} from "../themes/dribbblish/logic.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEME_DIR = path.join(HERE, "..", "themes", "dribbblish");
const css = readFileSync(path.join(THEME_DIR, "index.css"), "utf8");
const mod = readFileSync(path.join(THEME_DIR, "mod.tsx"), "utf8");
const metadata = JSON.parse(readFileSync(path.join(THEME_DIR, "metadata.json"), "utf8"));

describe("dribbblish frame", () => {
	it("uses the sidebar colour as a continuous outer frame around one main surface", () => {
		assert.match(
			css,
			/html\.spicetify-themed\s+\.Root__top-container\s*\{[^}]*background-color:\s*var\(--spice-sidebar\)\s*!important\s*;[^}]*padding:\s*var\(--main-gap\)\s+var\(--main-gap\)\s+var\(--main-gap\)\s+0\s*!important\s*;/s,
		);
		assert.match(css, /\.Root__right-sidebar\s*\{[^}]*background-color:\s*var\(--spice-main\)\s*!important\s*;/s);
	});

	it("turns the minimized Now Playing peek into a quiet black arrow rail", () => {
		assert.match(
			css,
			/\.ylx\s+\.Root__top-container:has\(>\s*\.Root__right-sidebar\s+\[inert\]\s+\.main-nowPlayingView-container\)\s*\{[^}]*grid-template-columns:\s*var\(--dribbblish-sidebar-width,\s*72px\)\s+minmax\(0,\s*1fr\)\s+32px\s+0\s*!important\s*;/s,
		);
		assert.match(
			css,
			/\.Root__right-sidebar:has\(\[inert\]\s+\.main-nowPlayingView-container\)[^{]*\{[^}]*width:\s*32px\s*!important\s*;[^}]*background-color:\s*var\(--spice-main\)\s*!important\s*;/s,
		);
		assert.match(
			css,
			/\.Root__right-sidebar:has\(\[inert\]\s+\.main-nowPlayingView-container\)\s+\[inert\]\s*\{[^}]*display:\s*none\s*!important\s*;/s,
		);
		assert.match(
			css,
			/\.Root__right-sidebar:has\(\[inert\]\s+\.main-nowPlayingView-container\)\s*>\s*div\s*>\s*div\s*\{[^}]*transform:\s*none\s*!important\s*;[^}]*transition:\s*none\s*!important\s*;/s,
		);
		assert.match(
			css,
			/\.Root__right-sidebar:has\(\[inert\]\s+\.main-nowPlayingView-container\)[^{]*>\s*div:last-child\s*>\s*button\s*\{[^}]*width:\s*32px\s*;[^}]*height:\s*48px\s*;[^}]*transform:\s*none\s*!important\s*;[^}]*transition:\s*none\s*!important\s*;/s,
		);
		assert.match(
			css,
			/\.Root__right-sidebar:has\(\[inert\]\s+\.main-nowPlayingView-container\)[^{]*>\s*div:last-child\s*\{[^}]*opacity:\s*1\s*!important\s*;[^}]*transition:\s*none\s*!important\s*;/s,
		);
	});

	it("lays registered nav links out in the green rail and reserves their measured space", () => {
		assert.match(css, /#dribbblish-navlinks-rail\s*\{[^}]*position:\s*absolute\s*;/s);
		assert.match(
			css,
			/#dribbblish-navlinks-rail\s+\.spicetify-navlinks-anchor\s*\{[^}]*flex-direction:\s*column\s*;/s,
		);
		assert.match(css, /\.Root__nav-bar\s*\{[^}]*padding-top:\s*var\(--dribbblish-navlinks-reserve,\s*0px\)\s*;/s);
		assert.match(mod, /relocateElement\(navlinks,\s*rail\)/);
		assert.match(mod, /--dribbblish-navlinks-reserve/);
	});

	it("uses the title strip for a horizontal rail when the library is expanded", () => {
		assert.deepEqual(navlinkRailLayout(72, 5), { expanded: false, reserve: 202 });
		assert.deepEqual(navlinkRailLayout(287, 5), { expanded: false, reserve: 202 });
		assert.deepEqual(navlinkRailLayout(288, 5), { expanded: true, reserve: 0 });
		assert.deepEqual(navlinkRailLayout(397, 5), { expanded: true, reserve: 0 });
		assert.deepEqual(navlinkRailLayout(397, 8), { expanded: false, reserve: 364 });
		assert.match(
			css,
			/#dribbblish-navlinks-rail\.dribbblish-navlinks-rail--expanded\s*\{[^}]*justify-content:\s*flex-start\s*;[^}]*padding-left:\s*18px\s*;/s,
		);
		assert.match(
			css,
			/#dribbblish-navlinks-rail\.dribbblish-navlinks-rail--expanded\s+\.spicetify-navlinks-anchor\s*\{[^}]*flex-direction:\s*row\s*;/s,
		);
	});

	it("puts Home and Search first and opens the native search form beside the rail", () => {
		assert.match(mod, /navlinks\.prepend\(homeItem\)/);
		assert.match(mod, /homeItem\.after\(searchItem\)/);
		assert.doesNotMatch(mod, /relocateElement\((?:homeButton|searchSection)/);
		assert.match(mod, /new MutationObserver\(\(\) => \{/);
		assert.match(mod, /querySelector<HTMLInputElement>\('\[data-testid="search-input"\]'\)\?\.focus\(\)/);
		assert.match(mod, /querySelector<HTMLInputElement>\('\[data-testid="search-input"\]'\)\?\.blur\(\)/);
		assert.deepEqual(floatingSearchLayout({ top: 64 }, { right: 72 }, 800), {
			left: 80,
			top: 64,
			width: 420,
		});
		assert.deepEqual(floatingSearchLayout({ top: 10 }, { right: 397 }, 800), {
			left: 405,
			top: 10,
			width: 383,
		});
		assert.match(
			css,
			/\.main-globalNav-searchSection\.dribbblish-search-host\s*\{[^}]*position:\s*fixed\s*;[^}]*z-index:\s*20\s*;/s,
		);
	});

	it("lets Home and Search use the same native hover surface as registered rail buttons", () => {
		assert.doesNotMatch(
			css,
			/#dribbblish-navlinks-rail[^{}]*(?::hover|\[aria-expanded)[^{}]*\{[^}]*background(?:-color)?\s*:/s,
		);
	});

	it("mirrors registered buttons without their React tooltip handlers", async () => {
		const parent = document.createElement("div");
		const source = document.createElement("button");
		source.className = "main-globalNav-navLink";
		source.id = "react-owned-button";
		source.setAttribute("aria-label", "Module Store");
		source.innerHTML = '<svg data-icon="outline"></svg>';
		let clicks = 0;
		source.addEventListener("click", () => clicks++);
		parent.append(source);

		const mirror = mirrorRailButton(source);
		assert.equal(source.hasAttribute("data-dribbblish-rail-source"), true);
		assert.equal(source.style.getPropertyValue("display"), "none");
		assert.equal(source.style.getPropertyPriority("display"), "important");
		assert.equal(mirror.button.classList.contains("dribbblish-rail-button"), true);
		assert.equal(mirror.button.getAttribute("aria-label"), "Module Store");
		assert.equal(mirror.button.hasAttribute("id"), false);
		mirror.button.click();
		assert.equal(clicks, 1);

		source.classList.add("main-globalNav-navLinkActive");
		source.disabled = true;
		source.innerHTML = '<svg data-icon="filled"></svg>';
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(mirror.button.classList.contains("main-globalNav-navLinkActive"), true);
		assert.equal(mirror.button.disabled, true);
		assert.equal(mirror.button.querySelector("svg")?.getAttribute("data-icon"), "filled");

		mirror.button.dispatchEvent(new Event("pointerenter"));
		const tooltip = document.querySelector<HTMLElement>(".dribbblish-rail-tooltip");
		assert.equal(tooltip?.textContent, "Module Store");
		assert.equal(mirror.button.getAttribute("aria-describedby"), tooltip?.id);
		assert.equal(tooltip?.hasAttribute("data-visible"), true);
		mirror.button.dispatchEvent(new Event("pointerleave"));
		await new Promise((resolve) => setTimeout(resolve, 150));
		tooltip?.dispatchEvent(new Event("pointerenter"));
		await new Promise((resolve) => setTimeout(resolve, 180));
		assert.equal(tooltip?.hasAttribute("data-visible"), true);
		tooltip?.dispatchEvent(new Event("pointerleave"));
		await new Promise((resolve) => setTimeout(resolve, 310));
		assert.equal(tooltip?.hasAttribute("data-visible"), false);
		mirror.button.disabled = false;
		mirror.button.dispatchEvent(new Event("focus"));
		assert.equal(tooltip?.hasAttribute("data-visible"), true);
		mirror.button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		assert.equal(tooltip?.hasAttribute("data-visible"), false);

		mirror.dispose();
		assert.equal(source.hasAttribute("data-dribbblish-rail-source"), false);
		assert.equal(source.style.display, "");
		assert.equal(mirror.button.isConnected, false);
		assert.equal(tooltip?.isConnected, false);
		parent.remove();
	});

	it("positions rail tooltips beside compact actions and below expanded ones", () => {
		const button = { bottom: 58, height: 48, left: 10, right: 58, top: 10, width: 48 };
		const tooltip = { height: 34, width: 104 };
		assert.deepEqual(railTooltipPosition(button, tooltip, { height: 300, width: 500 }, false), {
			left: 66,
			top: 17,
		});
		assert.deepEqual(railTooltipPosition(button, tooltip, { height: 300, width: 500 }, true), {
			left: 8,
			top: 66,
		});
	});

	it("keeps rail tooltips on screen at compact and expanded edges", () => {
		const button = { bottom: 292, height: 48, left: 444, right: 492, top: 244, width: 48 };
		const tooltip = { height: 34, width: 104 };
		assert.deepEqual(railTooltipPosition(button, tooltip, { height: 300, width: 500 }, false), {
			left: 332,
			top: 251,
		});
		assert.deepEqual(railTooltipPosition(button, tooltip, { height: 300, width: 500 }, true), {
			left: 388,
			top: 202,
		});
	});

	it("removes leaked mirrors before a hot-reloaded rail rebinds", () => {
		const root = document.createElement("div");
		const source = document.createElement("button");
		source.setAttribute("data-dribbblish-rail-source-display", "inline-flex");
		source.setAttribute("data-dribbblish-rail-source-display-priority", "important");
		source.setAttribute("data-dribbblish-rail-source", "");
		source.style.setProperty("display", "none", "important");
		const stale = document.createElement("button");
		stale.className = "dribbblish-rail-button";
		const staleTooltip = document.createElement("div");
		staleTooltip.className = "dribbblish-rail-tooltip";
		document.body.append(staleTooltip);
		root.append(source, stale);

		removeStaleRailMirrors(root);
		assert.deepEqual([...root.children], [source]);
		assert.equal(source.hasAttribute("data-dribbblish-rail-source"), false);
		assert.equal(source.hasAttribute("data-dribbblish-rail-source-display"), false);
		assert.equal(source.style.display, "inline-flex");
		assert.equal(source.style.getPropertyPriority("display"), "important");
		assert.equal(staleTooltip.isConnected, false);
	});

	it("reveals the expanded library after its layout settles", () => {
		assert.match(css, /@keyframes\s+dribbblish-library-reveal\s*\{/);
		assert.match(
			css,
			/\.main-yourLibraryX-libraryContainer:not\(:has\(\.main-yourLibraryX-headerIsCollapsed\)\)\s*\{[^}]*animation:\s*dribbblish-library-reveal\s+220ms\s+cubic-bezier\(0\.2,\s*0\.8,\s*0\.2,\s*1\)\s*;/s,
		);
		assert.match(
			css,
			/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.main-yourLibraryX-libraryContainer:not\(:has\(\.main-yourLibraryX-headerIsCollapsed\)\)\s*\{[^}]*animation:\s*none\s*;/s,
		);
	});

	it("rebinds floating search when Spotify replaces its React-owned host", () => {
		const first = document.createElement("div");
		const replacement = document.createElement("div");
		let current = syncSearchHostClasses(null, first, true);
		assert.equal(first.classList.contains(SEARCH_HOST_CLASS), true);
		assert.equal(first.classList.contains(SEARCH_HOST_OPEN_CLASS), true);

		current = syncSearchHostClasses(current, replacement, false);
		assert.equal(current, replacement);
		assert.equal(first.classList.contains(SEARCH_HOST_CLASS), false);
		assert.equal(first.classList.contains(SEARCH_HOST_OPEN_CLASS), false);
		assert.equal(replacement.classList.contains(SEARCH_HOST_CLASS), true);
		assert.equal(replacement.classList.contains(SEARCH_HOST_OPEN_CLASS), false);
	});

	it("restores only the native inline properties the floating host overrides", () => {
		const host = document.createElement("div");
		host.style.setProperty("left", "11px", "important");
		host.style.top = "22px";
		const snapshot = captureInlineStyles(host, ["left", "top", "width"]);
		host.style.left = "80px";
		host.style.top = "64px";
		host.style.width = "420px";
		host.style.height = "50px";

		restoreInlineStyles(host, snapshot);
		assert.equal(host.style.getPropertyValue("left"), "11px");
		assert.equal(host.style.getPropertyPriority("left"), "important");
		assert.equal(host.style.top, "22px");
		assert.equal(host.style.width, "");
		assert.equal(host.style.height, "50px");
	});

	it("centres the collapsed library opener and artwork on the compact rail", () => {
		assert.match(
			css,
			/\.main-yourLibraryX-collapseButton\.main-yourLibraryX-headerIsCollapsed\s*\{[^}]*width:\s*48px\s*!important\s*;[^}]*height:\s*48px\s*!important\s*;[^}]*transform:\s*translateX\(-4px\)\s*;/s,
		);
		assert.match(
			css,
			/\.main-yourLibraryX-collapseButton\.main-yourLibraryX-headerIsCollapsed button\s*\{[^}]*padding:\s*12px\s*!important\s*;[^}]*border-radius:\s*50%\s*!important\s*;/s,
		);
		assert.match(
			css,
			/\.main-yourLibraryX-collapseButton\.main-yourLibraryX-headerIsCollapsed\s+button\s*>\s*span:not\(\[data-encore-id="visuallyHidden"\]\)\s*\{[^}]*background-color:\s*transparent\s*!important\s*;/s,
		);
		assert.match(
			css,
			/\.main-yourLibraryX-collapseButton\.main-yourLibraryX-headerIsCollapsed button\s*>\s*span:nth-of-type\(2\)\s*\{[^}]*top:\s*50%\s*!important\s*;[^}]*left:\s*50%\s*!important\s*;[^}]*margin:\s*0\s*!important\s*;[^}]*width:\s*24px\s*!important\s*;[^}]*height:\s*24px\s*!important\s*;[^}]*transform:\s*translate\(-50%,\s*-50%\)\s*!important\s*;/s,
		);
		assert.match(
			css,
			/\.main-yourLibraryX-collapseButton\.main-yourLibraryX-headerIsCollapsed button:hover\s*>\s*span:first-of-type\s*\{[^}]*opacity:\s*0\s*!important\s*;/s,
		);
		assert.match(
			css,
			/\.main-yourLibraryX-libraryContainer:has\(\.main-yourLibraryX-headerIsCollapsed\)[^{]*:is\([^)]*\.x-entityImage-imageContainer[^)]*\.main-yourLibraryX-rowCover[^)]*\)\s*\{[^}]*transform:\s*translateX\(4px\)\s*;/s,
		);
	});

	it("restores registered nav links to their exact sibling position", () => {
		const original = document.createElement("div");
		const before = document.createElement("span");
		const navlinks = document.createElement("div");
		const after = document.createElement("span");
		const rail = document.createElement("div");
		original.append(before, navlinks, after);
		document.body.append(original, rail);

		const restore = relocateElement(navlinks, rail);
		assert.equal(navlinks.parentElement, rail);
		restore();
		assert.deepEqual([...original.children], [before, navlinks, after]);

		original.remove();
		rail.remove();
	});

	it("removes moved links when their original surface has gone away", () => {
		const original = document.createElement("div");
		const navlinks = document.createElement("div");
		const rail = document.createElement("div");
		original.append(navlinks);
		document.body.append(original, rail);

		const restore = relocateElement(navlinks, rail);
		original.remove();
		restore();
		assert.equal(navlinks.isConnected, false);

		rail.remove();
	});
});

describe("dribbblish window controls contract", () => {
	it("requires the hide-window-controls extension", () => {
		assert.equal(metadata.dependencies["hide-window-controls"], "^0.1.4");
	});

	it("marks the requirement for the dependency and removes it on teardown", () => {
		assert.match(mod, /setAttribute\(HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE,\s*""\)/);
		assert.match(mod, /removeAttribute\(HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE\)/);
	});
});
