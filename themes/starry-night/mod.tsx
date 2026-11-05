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

import { mountSky } from "./mount.ts";
import type { AnimationHandle } from "./sky.ts";

// The width the client persists for the right sidebar. The playbar tracks
// the sidebar so the two stacked panels share an edge.
const PANEL_WIDTH_KEY = `${client.platform.username}:panel-width`;
const FALLBACK_PANEL_WIDTH = 420;

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

	// The sky owns its own frames, timers and listeners and releases them
	// all on dispose.
	const sky = mountSky({
		document,
		window,
		rand: Math.random,
		getContext: (canvas) => canvas.getContext("2d"),
		createCanvas: () => document.createElement("canvas"),
		requestFrame: (cb) => requestAnimationFrame(cb),
		cancelFrame: (id) => cancelAnimationFrame(id),
		setTimer: (fn, ms) => window.setTimeout(fn, ms),
		clearTimer: (id) => clearTimeout(id),
		animate: (el, keyframes, options) => el.animate(keyframes, options) as AnimationHandle,
	});
	ctx.defer(sky.dispose);
	if (!(await sky.ready) || disposed) return;

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
