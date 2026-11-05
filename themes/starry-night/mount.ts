/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// DOM discovery, event wiring and lifecycle for the sky. The browser comes
// in through MountEnv so tests can drive it with fakes.

import { createSky, type Sky, type SkyColors, type SkyDeps } from "./sky.ts";

export interface MountEnv extends Omit<SkyDeps, "container" | "viewport" | "readColors"> {
	document: Document;
	window: Pick<
		Window,
		| "addEventListener"
		| "removeEventListener"
		| "innerWidth"
		| "innerHeight"
		| "devicePixelRatio"
		| "matchMedia"
		| "getComputedStyle"
	>;
	/** Default 20. */
	waitTries?: number;
	/** Default 250. */
	waitIntervalMs?: number;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function mountSky(env: MountEnv): { ready: Promise<boolean>; dispose(): void } {
	const { document: doc, window: win } = env;
	let disposed = false;
	let waitTimer: number | null = null;
	let settle: (mounted: boolean) => void = () => {};
	let sky: Sky | null = null;
	let backdrop: HTMLElement | null = null;
	const cleanups: (() => void)[] = [];

	const listen = (
		target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
		type: string,
		fn: EventListener,
	) => {
		target.addEventListener(type, fn);
		cleanups.push(() => target.removeEventListener(type, fn));
	};

	// A palette variable the sky cannot read comes back as "", which the
	// renderer replaces with its fallback. Present ones are read resolved,
	// so any color syntax the palette writes reaches the canvas as rgb().
	const readColors = (sentinel: HTMLElement): SkyColors => {
		const style = win.getComputedStyle(sentinel);
		const has = (name: string) => style.getPropertyValue(name).trim() !== "";
		return {
			star: has("--spice-star") ? style.color : "",
			glow: has("--spice-star-glow") ? style.backgroundColor : "",
		};
	};

	const mount = (top: Element) => {
		backdrop = doc.createElement("div");
		backdrop.className = "starrynight-bg-container";
		top.appendChild(backdrop);

		const reduced = win.matchMedia(REDUCED_MOTION);
		const visible = () => doc.visibilityState !== "hidden";
		const current = (sky = createSky(
			{
				...env,
				container: backdrop,
				viewport: () => ({ width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio }),
				readColors,
			},
			{ visible: visible(), reducedMotion: reduced.matches },
		));

		listen(win, "resize", () => current.resize());
		listen(doc, "visibilitychange", () => current.setVisible(visible()));
		listen(reduced, "change", () => current.setReducedMotion(reduced.matches));

		// A resolution query matches only the current ratio; re-arm it for
		// the new one after every change.
		let dprQuery: MediaQueryList | null = null;
		const onDpr = () => {
			current.resize();
			watchDpr();
		};
		const watchDpr = () => {
			dprQuery?.removeEventListener("change", onDpr);
			dprQuery = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
			dprQuery.addEventListener("change", onDpr);
		};
		watchDpr();
		cleanups.push(() => dprQuery?.removeEventListener("change", onDpr));

		const sentinel = backdrop.querySelector<HTMLElement>(".starrynight-sentinel");
		if (sentinel) {
			const recolor = () => current.colorsChanged();
			listen(sentinel, "transitionend", recolor);
			listen(sentinel, "transitionrun", recolor);
		}
	};

	// Bounded: the loader awaits the module, so a container that never
	// appears must give up rather than hang every other module.
	const ready = new Promise<boolean>((resolve) => {
		settle = resolve;
		let left = env.waitTries ?? 20;
		const attempt = () => {
			waitTimer = null;
			if (disposed) return resolve(false);
			const top = doc.querySelector(".Root__top-container");
			if (top) {
				mount(top);
				return resolve(true);
			}
			if (left-- <= 0) return resolve(false);
			waitTimer = env.setTimer(attempt, env.waitIntervalMs ?? 250);
		};
		attempt();
	});

	return {
		ready,
		dispose() {
			if (disposed) return;
			disposed = true;
			if (waitTimer !== null) env.clearTimer(waitTimer);
			waitTimer = null;
			settle(false);
			for (const cleanup of cleanups.splice(0)) cleanup();
			sky?.dispose();
			sky = null;
			backdrop?.remove();
			backdrop = null;
		},
	};
}
