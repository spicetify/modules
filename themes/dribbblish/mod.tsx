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

// Horizontal padding the tooltip keeps from either end of the progress bar.
const TOOLTIP_EDGE_GAP = 12;

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
	const sidebar = await waitFor<HTMLElement>(".Root__nav-bar, #Desktop_LeftSidebar_Id");
	const globalNav = await waitFor<HTMLElement>(".Root__globalNav");
	if (disposed) return;
	if (sidebar && globalNav) {
		const syncWidth = () => {
			const declared = Number(getComputedStyle(sidebar).getPropertyValue("--left-sidebar-width").trim());
			globalNav.style.setProperty("--left-sidebar-width", String(declared || sidebar.clientWidth));
		};
		const observer = new ResizeObserver(syncWidth);
		observer.observe(sidebar);
		syncWidth();
		ctx.defer(() => {
			observer.disconnect();
			globalNav.style.removeProperty("--left-sidebar-width");
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
