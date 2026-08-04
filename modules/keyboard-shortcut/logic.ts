/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The pure core of keyboard-shortcut: vim-label sequencing and stepping,
// visibility/position math and the sidebar rotation index, hoisted from the
// module closure so they run under node --test. mod.tsx owns the DOM,
// Mousetrap and overlays.

export const KEY_LIST = "qwertasdfgzxcvyuiophjklbnm".split("");

// Two-letter labels in the same firstKey/secondKey rotation the overlay uses:
// qq, qw, qe ... qm, wq, ww ...
export function keyLabelAt(index: number): string {
	const first = Math.floor(index / KEY_LIST.length) % KEY_LIST.length;
	const second = index % KEY_LIST.length;
	return KEY_LIST[first] + KEY_LIST[second];
}

// One keypress against one visible label. The overlay removes labels that
// stopped matching, interacts when a label is exhausted, and trims otherwise.
export function stepLabel(
	text: string,
	key: string,
): { action: "drop" } | { action: "interact" } | { action: "trim"; rest: string } {
	if (text[0] !== key) return { action: "drop" };
	const rest = text.slice(1);
	if (rest.length === 0) return { action: "interact" };
	return { action: "trim", rest };
}

export interface Bound {
	top: number;
	bottom: number;
	left: number;
	right: number;
	width: number;
	height: number;
}

export function isOutOfView(bound: Bound, owner: { clientWidth: number; clientHeight: number }): boolean {
	return (
		bound.bottom > owner.clientHeight ||
		bound.left > owner.clientWidth ||
		bound.right < 0 ||
		bound.top < 0 ||
		bound.width === 0 ||
		bound.height === 0
	);
}

// Row elements keep their corner position; everything else centers the
// 30px label on the element.
export function labelPosition(bound: Bound, isRow: boolean): { top: number; left: number } {
	if (isRow) return { top: bound.top, left: bound.left };
	return { top: bound.top + bound.height / 2 - 15, left: bound.left + bound.width / 2 - 15 };
}

export function rotateIndex(current: number, direction: 1 | -1, maxIndex: number): number {
	const index = current + direction;
	if (index < 0) return maxIndex;
	if (index > maxIndex) return 0;
	return index;
}
