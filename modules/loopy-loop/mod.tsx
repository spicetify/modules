/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Loopy loop" extension by
 * khanhas. Right click on the progress bar to set song start/end markers and
 * section skips; all points persist per song across sessions. The client's
 * v2-compatible Player events, LocalStorage and showNotification helpers still
 * work in v3, so the logic is kept near-verbatim. The playbar control mounts
 * through the registrar and all teardown routes through the module lifecycle.
 */

import { client, createRegistrar, type ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { findActiveZone, moveEnd, moveStart, moveZoneEdge, parseStoredState, restartThresholds } from "./logic.ts";

import type { SkipZone } from "./logic.ts";

export default async function (ctx: ModuleRuntimeContext) {
	let disposed = false;
	const timers = new Set<number>();
	const cleanups: Array<() => void> = [];

	const setT = (fn: () => void, ms: number): number => {
		const id = window.setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
		return id;
	};

	ctx.defer(() => {
		disposed = true;
		for (const id of timers) clearTimeout(id);
		timers.clear();
		for (const fn of cleanups) fn();
		cleanups.length = 0;
	});

	function getBar(): HTMLElement | null {
		// v3 exposes the playbar progress bar via data-testid; fall back to the
		// legacy class for older clients.
		return (document.querySelector('[data-testid="progress-bar"]') ??
			document.querySelector('[data-testid="playback-progressbar"]') ??
			document.querySelector(".playback-progressbar-container")) as HTMLElement | null;
	}

	// Late DOM: wait for the playbar progress bar to mount, then set everything
	// up. Bounded so a missing bar degrades (no markers) instead of hanging the
	// module loader, which awaits this function.
	const bar = await new Promise<HTMLElement | null>((resolve) => {
		let tries = 0;
		const attempt = () => {
			if (disposed) return resolve(null);
			const found = getBar();
			if (found) return resolve(found);
			if (++tries > 50) return resolve(null);
			setT(attempt, 100);
		};
		attempt();
	});
	if (!bar || disposed) return;

	// ----- persistent per-song state -----
	let start: number | null = null;
	let end: number | null = null;
	let mouseOnBarPercent = 0.0;
	let skipZones: SkipZone[] = [];
	let pendingSkipStart: number | null = null;
	let lastSkipSeek = 0;
	let lastSkippedZoneIdx = -1;
	let lastNextCall = 0;
	let lastEndLoopSeek = 0;
	let seekStartPendingUri: string | null = null;
	let lastStartEnforce = 0;
	let prevProgressPercent = -1;
	let prevPressedAt = 0; // timestamp of first prev press; second press within 1.5s skips to prev song
	let navigatingBack = false; // true after back() is called; cleared in songchange to skip stale onprogress ticks
	let activeMarkerType: string | null = null; // "start" | "end" | "zoneStart" | "zoneEnd" | "zone" | null
	let activeZoneIndex = -1;

	const startMark = document.createElement("div");
	startMark.id = "loopy-loop-start";
	startMark.innerText = "[";
	const endMark = document.createElement("div");
	endMark.id = "loopy-loop-end";
	endMark.innerText = "]";
	startMark.style.position = endMark.style.position = "absolute";
	startMark.hidden = endMark.hidden = true;

	bar.append(startMark, endMark);

	function drawOnBar() {
		const currentBar = getBar();
		if (currentBar && startMark.parentElement !== currentBar) {
			currentBar.append(startMark, endMark);
		}
		startMark.hidden = start === null;
		endMark.hidden = end === null;
		if (start !== null) startMark.style.left = `${start * 100}%`;
		if (end !== null) endMark.style.left = `${end * 100}%`;
	}

	function drawSkipMarkers() {
		const currentBar = getBar() ?? bar;
		if (!currentBar) return;
		currentBar.querySelectorAll(".loopy-skip-marker").forEach((el) => el.remove());
		skipZones.forEach((zone, index) => {
			const s = document.createElement("div");
			s.className = "loopy-skip-marker";
			s.innerText = "{";
			s.style.left = `${zone.start * 100}%`;
			s.dataset.zoneIndex = String(index);
			s.dataset.zoneSide = "start";

			const e = document.createElement("div");
			e.className = "loopy-skip-marker";
			e.innerText = "}";
			e.style.left = `${zone.end * 100}%`;
			e.dataset.zoneIndex = String(index);
			e.dataset.zoneSide = "end";

			currentBar.append(e, s); // { appended after } so { sits higher in stacking order
		});

		if (pendingSkipStart !== null) {
			const p = document.createElement("div");
			p.className = "loopy-skip-marker";
			p.innerText = "{";
			p.style.left = `${pendingSkipStart * 100}%`;
			p.style.opacity = "0.4";
			currentBar.append(p);
		}
	}

	function saveState() {
		const uri = client.player.data?.item?.uri;
		if (!uri) return;
		client.storage.set(`loopyLoop:${uri}`, JSON.stringify({ start, end, skipZones }));
	}

	function loadState() {
		const uri = client.player.data?.item?.uri;
		start = null;
		end = null;
		skipZones = [];
		pendingSkipStart = null;
		if (!uri) return;
		const parsed = parseStoredState(client.storage.get(`loopyLoop:${uri}`));
		start = parsed.start;
		end = parsed.end;
		skipZones = parsed.skipZones;
	}

	// Position menu within viewport using fixed positioning
	function openMenu(menu: HTMLElement, x: number, y: number) {
		menu.style.left = "-9999px";
		menu.style.top = "0px";
		menu.hidden = false;
		const { height, width } = menu.getBoundingClientRect();
		menu.style.left = `${Math.min(x, window.innerWidth - width - 4)}px`;
		menu.style.top = `${Math.max(0, y - height)}px`;
	}

	function openContextMenu(x: number, y: number) {
		(skipStartBtn.querySelector("button") as HTMLButtonElement).textContent =
			pendingSkipStart !== null ? "Cancel skip start" : "Set section skip start";
		openMenu(contextMenu, x, y);
	}

	// Configure the conditional bottom section of the context menu
	function setupActiveMarker(type: string | null, zoneIdx?: number) {
		activeMarkerType = type;
		activeZoneIndex = zoneIdx ?? -1;
		const hasMarker = type !== null;
		const isSpecificMarker = type !== null && type !== "zone";
		divider2.hidden = !hasMarker;
		moveBtnItem.hidden = !isSpecificMarker;
		removeActiveBtn.hidden = !hasMarker;

		const removeBtn = removeActiveBtn.querySelector("button") as HTMLButtonElement;
		if (type === "start") {
			removeBtn.textContent = "Remove song start";
			removeBtn.onclick = (ev) => {
				ev.stopPropagation();
				start = null;
				drawOnBar();
				saveState();
				contextMenu.hidden = true;
				moveSubmenu.hidden = true;
			};
		} else if (type === "end") {
			removeBtn.textContent = "Remove song end";
			removeBtn.onclick = (ev) => {
				ev.stopPropagation();
				end = null;
				drawOnBar();
				saveState();
				contextMenu.hidden = true;
				moveSubmenu.hidden = true;
			};
		} else {
			removeBtn.textContent = "Remove section";
			removeBtn.onclick = (ev) => {
				ev.stopPropagation();
				if (activeZoneIndex >= 0) {
					skipZones.splice(activeZoneIndex, 1);
					saveState();
					drawSkipMarkers();
					activeZoneIndex = -1;
				}
				contextMenu.hidden = true;
				moveSubmenu.hidden = true;
			};
		}
	}

	// Move submenu
	const moveSubmenu = document.createElement("div");
	moveSubmenu.id = "loopy-move-submenu";
	moveSubmenu.innerHTML = `<ul tabindex="0" class="main-contextMenu-menu"></ul>`;
	moveSubmenu.hidden = true;
	document.body.append(moveSubmenu);

	function applyMoveAdjustment(deltaSeconds: number) {
		const durationMs = client.player.getDuration();
		if (!durationMs) return;
		const delta = (deltaSeconds * 1000) / durationMs;
		if (activeMarkerType === "start" && start !== null) {
			start = moveStart(start, end, delta);
			drawOnBar();
		} else if (activeMarkerType === "end" && end !== null) {
			end = moveEnd(end, start, delta);
			drawOnBar();
		} else if (activeMarkerType === "zoneStart" || activeMarkerType === "zoneEnd") {
			if (activeZoneIndex < 0 || activeZoneIndex >= skipZones.length) return;
			const side = activeMarkerType === "zoneStart" ? "start" : "end";
			skipZones[activeZoneIndex] = moveZoneEdge(skipZones[activeZoneIndex], side, delta);
			drawSkipMarkers();
		}
		saveState();
	}

	[-0.5, -0.1, -0.01, 0.01, 0.1, 0.5].forEach((delta) => {
		const li = document.createElement("li");
		li.setAttribute("role", "menuitem");
		const btn = document.createElement("button");
		btn.classList.add("main-contextMenu-menuItemButton");
		btn.textContent = `${delta > 0 ? "+" : ""}${delta}s`;
		btn.onclick = (e) => {
			e.stopPropagation();
			applyMoveAdjustment(delta);
		};
		li.append(btn);
		(moveSubmenu.firstElementChild as HTMLElement).append(li);
	});

	// Skip zone seeking + song start/end enforcement
	const onProgress = (event?: Event) => {
		const ts = event?.timeStamp ?? performance.now();
		const percent = client.player.getProgressPercent();

		// Repeat-mode restart: song restarted from 0 after hitting ], seek to [
		if (seekStartPendingUri !== null && percent < 0.05) {
			const currentUri = client.player.data?.item?.uri;
			if (currentUri === seekStartPendingUri && start !== null) {
				seekStartPendingUri = null;
				client.player.seek(start);
				return;
			}
			seekStartPendingUri = null;
		}

		// Detect prev button press: jump to ~0 from past Spotify's 3-second restart threshold
		const durationMs = client.player.getDuration() || 0;
		const { threeSecFrac, nearZeroFrac } = restartThresholds(durationMs);
		if (prevProgressPercent > threeSecFrac && percent < nearZeroFrac) {
			if (prevPressedAt > 0 && ts - prevPressedAt < 1500) {
				// Second press within 1.5s — go to previous song
				prevPressedAt = 0;
				prevProgressPercent = percent;
				navigatingBack = true;
				setT(() => {
					navigatingBack = false;
				}, 2000);
				client.player.back();
				return;
			}
			// First press — go to [ (or stay at 0 if no start set)
			prevPressedAt = ts;
			prevProgressPercent = percent;
			if (start !== null) client.player.seek(start);
			return;
		}
		prevProgressPercent = percent;

		// Song start enforcement: seek to [ if playback is before it (covers song load + manual scrub)
		if (start !== null && percent < start) {
			if (navigatingBack) return;
			if (ts - lastStartEnforce > 500) {
				lastStartEnforce = ts;
				client.player.seek(start);
			}
			return;
		}

		// Song end enforcement: at ], either loop back (repeat-one) or advance to next track
		if (end !== null && percent >= end) {
			// client.player.getRepeat(): 0 = off, 1 = repeat context, 2 = repeat track
			if (client.player.getRepeat() === 2) {
				if (ts - lastEndLoopSeek > 500) {
					lastEndLoopSeek = ts;
					client.player.seek(start ?? 0);
				}
			} else if (ts - lastNextCall > 2000) {
				lastNextCall = ts;
				seekStartPendingUri = client.player.data?.item?.uri ?? null;
				client.player.next();
			}
			return;
		}

		// Skip zone seeking
		if (skipZones.length > 0) {
			const i = findActiveZone(skipZones, percent);
			if (i === -1) {
				lastSkippedZoneIdx = -1;
			} else if (i !== lastSkippedZoneIdx || ts - lastSkipSeek > 500) {
				lastSkipSeek = ts;
				lastSkippedZoneIdx = i;
				client.player.seek(skipZones[i].end);
			}
		}
	};
	client.player.addEventListener("onprogress", onProgress);

	const onSongChange = () => {
		navigatingBack = false;
		// Clear seekStartPendingUri only when the new song differs — preserves repeat-one seek-to-[ behavior
		if (client.player.data?.item?.uri !== seekStartPendingUri) seekStartPendingUri = null;
		loadState();
		drawOnBar();
		drawSkipMarkers();
		prevProgressPercent = -1;
		prevPressedAt = 0;
		lastStartEnforce = 0;
		lastNextCall = 0;
		lastEndLoopSeek = 0;
		lastSkipSeek = 0;
		lastSkippedZoneIdx = -1;
	};
	client.player.addEventListener("songchange", onSongChange);

	// Context menu
	function createMenuItem(title: string, callback?: () => void): HTMLLIElement {
		const item = document.createElement("li");
		item.setAttribute("role", "menuitem");
		const button = document.createElement("button");
		button.classList.add("main-contextMenu-menuItemButton");
		button.textContent = title;
		button.onclick = (e) => {
			e.stopPropagation();
			contextMenu.hidden = true;
			moveSubmenu.hidden = true;
			callback?.();
		};
		item.append(button);
		return item;
	}

	const startBtn = createMenuItem("Set song start", () => {
		if (end !== null && mouseOnBarPercent >= end) {
			client.notify("Song start must be before song end");
			return;
		}
		start = mouseOnBarPercent;
		drawOnBar();
		saveState();
	});
	const endBtn = createMenuItem("Set song end", () => {
		if (start !== null && mouseOnBarPercent <= start) {
			client.notify("Song end must be after song start");
			return;
		}
		end = mouseOnBarPercent;
		drawOnBar();
		saveState();
	});

	const divider1 = document.createElement("li");
	divider1.style.cssText = "border-top:1px solid rgba(255,255,255,0.2);margin:4px 0;list-style:none;";

	const skipStartBtn = createMenuItem("Set section skip start", () => {
		if (pendingSkipStart !== null) {
			pendingSkipStart = null;
		} else {
			pendingSkipStart = mouseOnBarPercent;
		}
		drawSkipMarkers();
	});
	const skipEndBtn = createMenuItem("Set section skip end", () => {
		if (pendingSkipStart === null) {
			client.notify("No section skip start selected!");
			return;
		}
		const s = Math.min(pendingSkipStart, mouseOnBarPercent);
		const e = Math.max(pendingSkipStart, mouseOnBarPercent);
		if (e > s) {
			if (skipZones.length < 10) {
				skipZones.push({ start: s, end: e });
				saveState();
				drawSkipMarkers();
			} else {
				client.notify("Maximum 10 skip zones reached");
			}
		}
		pendingSkipStart = null;
	});
	const clearSkipsBtn = createMenuItem("Clear section skips", () => {
		skipZones = [];
		pendingSkipStart = null;
		saveState();
		drawSkipMarkers();
	});

	const resetMarkersBtn = createMenuItem("Reset song start/end", () => {
		start = null;
		end = null;
		drawOnBar();
		saveState();
	});

	const divider2 = document.createElement("li");
	divider2.style.cssText = "border-top:1px solid rgba(255,255,255,0.2);margin:4px 0;list-style:none;";
	divider2.hidden = true;

	// Move ▶ button
	const moveBtnItem = document.createElement("li");
	moveBtnItem.setAttribute("role", "menuitem");
	const moveBtnEl = document.createElement("button");
	moveBtnEl.classList.add("main-contextMenu-menuItemButton");
	moveBtnEl.textContent = "Move ▶";
	moveBtnItem.append(moveBtnEl);
	moveBtnItem.hidden = true;

	// Dynamic remove button — label/callback set by setupActiveMarker
	const removeActiveBtn = document.createElement("li");
	removeActiveBtn.setAttribute("role", "menuitem");
	const removeActiveBtnEl = document.createElement("button");
	removeActiveBtnEl.classList.add("main-contextMenu-menuItemButton");
	removeActiveBtnEl.textContent = "Remove section";
	removeActiveBtn.append(removeActiveBtnEl);
	removeActiveBtn.hidden = true;

	const contextMenu = document.createElement("div");
	contextMenu.id = "loopy-context-menu";
	contextMenu.innerHTML = `<ul tabindex="0" class="main-contextMenu-menu"></ul>`;
	(contextMenu.firstElementChild as HTMLElement).append(
		startBtn,
		endBtn,
		resetMarkersBtn,
		divider1,
		skipStartBtn,
		skipEndBtn,
		clearSkipsBtn,
		divider2,
		moveBtnItem,
		removeActiveBtn,
	);
	document.body.append(contextMenu);
	contextMenu.hidden = true;

	function showMoveSubmenu() {
		const rect = moveBtnEl.getBoundingClientRect();
		moveSubmenu.style.left = "-9999px";
		moveSubmenu.style.top = "0px";
		moveSubmenu.hidden = false;
		const { height, width } = moveSubmenu.getBoundingClientRect();
		moveSubmenu.style.left = `${Math.min(rect.right + 2, window.innerWidth - width - 4)}px`;
		moveSubmenu.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - height - 4))}px`;
	}

	let moveHideTimer: number | null = null;
	function scheduleMoveHide() {
		cancelMoveHide();
		moveHideTimer = window.setTimeout(() => {
			moveSubmenu.hidden = true;
			moveHideTimer = null;
		}, 150);
	}
	function cancelMoveHide() {
		if (moveHideTimer) {
			clearTimeout(moveHideTimer);
			moveHideTimer = null;
		}
	}

	moveBtnEl.onclick = (e) => {
		e.stopPropagation();
		cancelMoveHide();
		showMoveSubmenu();
	};
	moveBtnItem.addEventListener("mouseenter", () => {
		cancelMoveHide();
		showMoveSubmenu();
	});
	moveBtnItem.addEventListener("mouseleave", () => scheduleMoveHide());
	moveSubmenu.addEventListener("mouseenter", () => cancelMoveHide());
	moveSubmenu.addEventListener("mouseleave", () => scheduleMoveHide());

	// Close menus on outside click
	const onWindowClick = (e: MouseEvent) => {
		const target = e.target as Node;
		if (!contextMenu.contains(target) && !moveSubmenu.contains(target)) {
			contextMenu.hidden = true;
			moveSubmenu.hidden = true;
		}
	};
	window.addEventListener("click", onWindowClick);

	// Single capture-phase handler at document level — survives React re-renders
	const onContextMenu = (event: MouseEvent) => {
		const target = event.target as HTMLElement | null;
		if (!target) return;

		// [ song start marker
		if (target.id === "loopy-loop-start") {
			event.preventDefault();
			event.stopPropagation();
			mouseOnBarPercent = start ?? 0;
			setupActiveMarker("start");
			openContextMenu(event.clientX, event.clientY);
			return;
		}
		// ] song end marker
		if (target.id === "loopy-loop-end") {
			event.preventDefault();
			event.stopPropagation();
			mouseOnBarPercent = end ?? 1;
			setupActiveMarker("end");
			openContextMenu(event.clientX, event.clientY);
			return;
		}
		// { or } skip marker
		if (target.classList?.contains("loopy-skip-marker") && target.getAttribute("data-zone-index") !== null) {
			event.preventDefault();
			event.stopPropagation();
			const zIdx = parseInt(target.getAttribute("data-zone-index") as string, 10);
			if (!Number.isFinite(zIdx) || zIdx < 0 || zIdx >= skipZones.length) return;
			const side = target.getAttribute("data-zone-side") === "end" ? "zoneEnd" : "zoneStart";
			const smBar = getBar();
			if (smBar) {
				const { x, width } = smBar.getBoundingClientRect();
				mouseOnBarPercent = Math.max(0, Math.min(1, (event.clientX - x) / width));
			}
			setupActiveMarker(side, zIdx);
			openContextMenu(event.clientX, event.clientY);
			return;
		}

		// Progress bar area. Gate on the same getBar() fallback chain the
		// drawing code uses: .playback-progressbar-container no longer
		// exists on current clients, so the old gate never opened the menu.
		const currentBar = getBar();
		if (!currentBar?.contains(target)) return;
		event.preventDefault();
		event.stopPropagation();

		const { x, width } = currentBar.getBoundingClientRect();
		mouseOnBarPercent = Math.max(0, Math.min(1, (event.clientX - x) / width));

		const hitZone = skipZones.findIndex((z) => mouseOnBarPercent > z.start && mouseOnBarPercent < z.end);
		setupActiveMarker(hitZone >= 0 ? "zone" : null, hitZone);
		openContextMenu(event.clientX, event.clientY);
	};
	document.addEventListener("contextmenu", onContextMenu, true); // capture phase

	// Load state for the currently playing song on startup.
	// Retry until the player has track data (uri may be null immediately after init).
	function tryLoadInitialState(attemptsLeft: number) {
		if (disposed) return;
		if (client.player.data?.item?.uri) {
			loadState();
			drawOnBar();
			drawSkipMarkers();
		} else if (attemptsLeft > 0) {
			setT(() => tryLoadInitialState(attemptsLeft - 1), 200);
		}
	}
	tryLoadInitialState(10);

	// Toolbar button
	const registrar = createRegistrar(ctx);
	const markerIcon = `<rect x="1" y="7" width="14" height="2" rx="1"/><rect x="3" y="3" width="2" height="10" rx="1"/><rect x="11" y="3" width="2" height="10" rx="1"/><rect x="6" y="5" width="1.5" height="6" rx="0.75"/><rect x="8.5" y="5" width="1.5" height="6" rx="0.75"/>`;
	registrar.placeButton("playbar", {
		label: "Loopy Loop",
		icon: markerIcon,
		onClick: (event) => {
			event.stopPropagation();
			mouseOnBarPercent = client.player.getProgressPercent();
			setupActiveMarker(null, -1);
			const rect = event.currentTarget.getBoundingClientRect();
			openContextMenu(rect.left, rect.top);
		},
	});

	// ----- teardown -----
	cleanups.push(() => {
		client.player.removeEventListener("onprogress", onProgress);
		client.player.removeEventListener("songchange", onSongChange);
		window.removeEventListener("click", onWindowClick);
		document.removeEventListener("contextmenu", onContextMenu, true);
		cancelMoveHide();
		startMark.remove();
		endMark.remove();
		contextMenu.remove();
		moveSubmenu.remove();
		getBar()
			?.querySelectorAll(".loopy-skip-marker")
			.forEach((el) => el.remove());
	});
}
