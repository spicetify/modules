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
const NAVLINK_FIRST_ROW_OVERLAP = 14;
const EXPANDED_RAIL_LEFT_PADDING = 18;

export function navlinkRailLayout(width: number, buttonCount: number) {
	const expanded = width >= EXPANDED_RAIL_LEFT_PADDING + buttonCount * NAVLINK_PITCH;
	return {
		expanded,
		reserve: expanded ? 0 : Math.max(0, (buttonCount - 1) * NAVLINK_PITCH - NAVLINK_FIRST_ROW_OVERLAP),
	};
}

export function floatingSearchLayout(
	button: Pick<DOMRect, "top">,
	rail: Pick<DOMRect, "right">,
	viewportWidth: number,
	preferredWidth = 420,
) {
	const left = rail.right + 8;
	return {
		left,
		top: button.top,
		width: Math.max(0, Math.min(preferredWidth, viewportWidth - left - 12)),
	};
}

export const SEARCH_HOST_CLASS = "dribbblish-search-host";
export const SEARCH_HOST_OPEN_CLASS = "dribbblish-search-host--open";

export function syncSearchHostClasses(previous: HTMLElement | null, next: HTMLElement | null, open: boolean) {
	if (previous !== next) previous?.classList.remove(SEARCH_HOST_CLASS, SEARCH_HOST_OPEN_CLASS);
	next?.classList.add(SEARCH_HOST_CLASS);
	next?.classList.toggle(SEARCH_HOST_OPEN_CLASS, open);
	return next;
}

export interface InlineStyleProperty {
	value: string;
	priority: string;
}

export function captureInlineStyles(element: HTMLElement, properties: string[]) {
	return new Map<string, InlineStyleProperty>(
		properties.map((property) => [
			property,
			{
				value: element.style.getPropertyValue(property),
				priority: element.style.getPropertyPriority(property),
			},
		]),
	);
}

export function restoreInlineStyles(element: HTMLElement, snapshot: Map<string, InlineStyleProperty>) {
	for (const [property, { value, priority }] of snapshot) {
		if (value) element.style.setProperty(property, value, priority);
		else element.style.removeProperty(property);
	}
}
