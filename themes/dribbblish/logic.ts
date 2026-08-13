/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function relocateElement(element: Element, target: Element): () => void {
	const originalParent = element.parentNode;
	const originalNextSibling = element.nextSibling;
	target.append(element);

	return () => {
		if (originalParent?.isConnected) {
			originalParent.insertBefore(
				element,
				originalNextSibling?.parentNode === originalParent ? originalNextSibling : null,
			);
		} else {
			element.remove();
		}
	};
}

const NAVLINK_PITCH = 54;
const NAVLINK_FIRST_ROW_OVERLAP = 28;
const EXPANDED_RAIL_LEFT_PADDING = 18;

export function navlinkRailLayout(width: number, buttonCount: number) {
	const expanded = width >= EXPANDED_RAIL_LEFT_PADDING + buttonCount * NAVLINK_PITCH;
	return {
		expanded,
		reserve: expanded ? 0 : Math.max(0, (buttonCount - 1) * NAVLINK_PITCH - NAVLINK_FIRST_ROW_OVERLAP),
	};
}
