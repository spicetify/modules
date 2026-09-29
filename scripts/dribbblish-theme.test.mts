/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../modules/stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
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

describe("dribbblish frame", () => {
	it("uses the title strip for a horizontal rail when the library is expanded", () => {
		assert.deepEqual(navlinkRailLayout(72, 5), { expanded: false, reserve: 202 });
		assert.deepEqual(navlinkRailLayout(287, 5), { expanded: false, reserve: 202 });
		assert.deepEqual(navlinkRailLayout(288, 5), { expanded: true, reserve: 0 });
		assert.deepEqual(navlinkRailLayout(397, 5), { expanded: true, reserve: 0 });
		assert.deepEqual(navlinkRailLayout(397, 8), { expanded: false, reserve: 364 });
	});

	it("puts Home and Search first and opens the native search form beside the rail", () => {
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
