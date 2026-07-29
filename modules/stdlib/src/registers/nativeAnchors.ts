/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Semantic names for the client's own buttons, owned and maintained here so
// modules never hard-code fragile selectors. A module anchors to a stable
// name (e.g. "playbar:queue"); stdlib maps it to the current client's
// selectors. When Spotify moves a button, only this map changes — modules keep
// working, and placeButton falls back to order-placement if a name can't be
// resolved (so a stale map degrades, it never hides the button).
//
// Only locale-independent selectors are offered. The playbar controls carry
// stable data-testid attributes; the top-bar actions only expose localized
// aria-labels, so no top-bar anchors are published here.

export type NativeAnchor =
	| "playbar:lyrics"
	| "playbar:queue"
	| "playbar:mute"
	| "playbar:miniplayer"
	| "playbar:fullscreen";

// Candidate selectors per anchor, newest first; the first match in the DOM
// wins. Add older-client fallbacks to the array rather than branching.
export const NATIVE_ANCHOR_SELECTORS: Record<NativeAnchor, string[]> = {
	"playbar:lyrics": ['[data-testid="lyrics-button"]'],
	"playbar:queue": ['[data-testid="control-button-queue"]'],
	"playbar:mute": ['[data-testid="volume-bar-toggle-mute-button"]'],
	"playbar:miniplayer": ['[data-testid="pip-toggle-button"]'],
	"playbar:fullscreen": ['[data-testid="fullscreen-mode-button"]'],
};

export const isNativeAnchor = (name: string): name is NativeAnchor => Object.hasOwn(NATIVE_ANCHOR_SELECTORS, name);

// Resolve an anchor name to the live client element, or null if none of its
// selectors match (unknown name, or the client no longer renders it).
export const resolveNativeAnchor = (
	name: NativeAnchor,
	root: Pick<Document, "querySelector"> = document,
): Element | null => {
	const selectors = NATIVE_ANCHOR_SELECTORS[name];
	if (!selectors) return null;
	for (const selector of selectors) {
		const el = root.querySelector(selector);
		if (el) return el;
	}
	return null;
};
