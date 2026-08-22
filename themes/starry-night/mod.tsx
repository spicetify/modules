/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "StarryNight" theme by
 * Brandon Chen and Julissa Laignelet. The shooting-star effect is adapted
 * from a pure-CSS pen by Delroy Prithvi
 * (https://codepen.io/delroyprithvi/pen/LYyJROR), MIT.
 */

import { type ModuleRuntimeContext, client } from "/modules/stdlib/mod.ts";

// One star per this much backdrop area, at either 1px or 2px across.
const STAR_AREA_PER_STAR = 4000;
const TWINKLE_CHANCE = 1 / 5;
const TWINKLE_VARIANTS = 4;
const SHOOTING_STAR_COUNT = 4;
// The width the client persists for the right sidebar. The playbar tracks
// the sidebar so the two stacked panels share an edge.
const PANEL_WIDTH_KEY = `${client.platform.username}:panel-width`;
const FALLBACK_PANEL_WIDTH = 420;

const random = (min: number, max: number) => Math.random() * (max - min) + min;

// Shooting stars enter either from the top edge or the right edge, and are
// parked just off-screen so a delayed animation does not show a stray dot.
function placeShootingStar(star: HTMLElement): void {
	if (Math.random() < 0.75) {
		star.style.top = "-4px";
		star.style.right = `${random(0, 90)}%`;
	} else {
		star.style.top = `${random(0, 50)}%`;
		star.style.right = "-4px";
	}
}

function createStars(backdrop: HTMLElement, area: number): void {
	const count = Math.floor(area / STAR_AREA_PER_STAR);
	for (let i = 0; i < count; i++) {
		const size = Math.random() < 0.5 ? 1 : 2;
		const star = document.createElement("div");
		star.className = "starrynight-star";
		star.style.left = `${random(0, 99)}%`;
		star.style.top = `${random(0, 99)}%`;
		star.style.opacity = String(random(0.5, 1));
		star.style.width = `${size}px`;
		star.style.height = `${size}px`;
		if (Math.random() < TWINKLE_CHANCE) {
			const variant = Math.floor(Math.random() * TWINKLE_VARIANTS) + 1;
			star.style.setProperty("animation", `twinkle${variant} 5s infinite`, "important");
		}
		backdrop.appendChild(star);
	}
}

function createShootingStars(backdrop: HTMLElement, onEnd: (star: HTMLElement) => void): void {
	for (let i = 0; i < SHOOTING_STAR_COUNT; i++) {
		const star = document.createElement("span");
		star.className = "shootingstar";
		placeShootingStar(star);
		star.style.animationDuration = `${Math.floor(Math.random() * 3) + 3}s`;
		star.style.animationDelay = `${Math.floor(Math.random() * 7)}s`;
		star.addEventListener("animationend", () => onEnd(star));
		backdrop.appendChild(star);
	}
}

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

	const backdrop = document.createElement("div");
	backdrop.className = "starrynight-bg-container";

	ctx.defer(() => {
		disposed = true;
		for (const id of timers) clearTimeout(id);
		timers.clear();
		backdrop.remove();
	});

	const topContainer = await waitFor<HTMLElement>(".Root__top-container");
	if (!topContainer || disposed) return;
	topContainer.appendChild(backdrop);

	// The backdrop is a viewport-sized fixed layer. Sizing off the viewport
	// rather than its own box keeps the star count right even if the theme
	// stylesheet has not been adopted yet when this runs.
	createStars(backdrop, window.innerWidth * window.innerHeight);
	createShootingStars(backdrop, (star) => {
		placeShootingStar(star);
		// Restart the animation with a fresh duration: drop it, force a
		// reflow so the removal takes, then let the class rule reapply.
		star.style.animation = "none";
		void star.offsetWidth;
		star.style.animation = "";
		star.style.setProperty("animation-duration", `${Math.floor(Math.random() * 4) + 3}s`, "important");
	});

	// Keep the playbar the same width as the right sidebar stacked above it.
	const playbar = document.querySelector<HTMLElement>(".Root__now-playing-bar");
	const rightSidebar = await waitFor<HTMLElement>(".Root__right-sidebar");
	if (!playbar || !rightSidebar || disposed) return;

	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) {
			if (entry.target !== rightSidebar) continue;
			// A collapsed sidebar reports 0; fall back to the width the
			// client remembers so the playbar keeps its expanded size.
			const width =
				entry.contentRect.width || Number(localStorage.getItem(PANEL_WIDTH_KEY)) || FALLBACK_PANEL_WIDTH;
			playbar.style.width = `${width}px`;
			break;
		}
	});
	observer.observe(rightSidebar);
	ctx.defer(() => {
		observer.disconnect();
		playbar.style.removeProperty("width");
	});
}
