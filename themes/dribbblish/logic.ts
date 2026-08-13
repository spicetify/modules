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

type Rect = Pick<DOMRect, "bottom" | "height" | "left" | "right" | "top" | "width">;
let tooltipSerial = 0;

export function railTooltipPosition(
	button: Rect,
	tooltip: Pick<DOMRect, "height" | "width">,
	viewport: { height: number; width: number },
	expanded: boolean,
) {
	const gap = 8;
	const padding = 8;
	if (expanded) {
		const fitsBelow = button.bottom + gap + tooltip.height <= viewport.height - padding;
		return {
			left: Math.min(
				Math.max(button.left + (button.width - tooltip.width) / 2, padding),
				viewport.width - tooltip.width - padding,
			),
			top: fitsBelow ? button.bottom + gap : button.top - gap - tooltip.height,
		};
	}

	const fitsRight = button.right + gap + tooltip.width <= viewport.width - padding;
	return {
		left: Math.max(padding, fitsRight ? button.right + gap : button.left - gap - tooltip.width),
		top: Math.min(
			Math.max(button.top + (button.height - tooltip.height) / 2, padding),
			viewport.height - tooltip.height - padding,
		),
	};
}

export function mirrorRailButton(source: HTMLButtonElement) {
	const button = source.cloneNode(true) as HTMLButtonElement;
	const tooltip = document.createElement("div");
	const sourceDisplay = {
		value: source.style.getPropertyValue("display"),
		priority: source.style.getPropertyPriority("display"),
	};
	tooltip.className = "dribbblish-rail-tooltip";
	tooltip.id = `dribbblish-rail-tooltip-${++tooltipSerial}`;
	tooltip.setAttribute("role", "tooltip");
	document.body.append(tooltip);
	button.removeAttribute("id");
	button.removeAttribute("aria-describedby");
	button.removeAttribute("data-context-menu-open");
	button.classList.add("dribbblish-rail-button");
	source.setAttribute("data-dribbblish-rail-source", "");
	source.setAttribute("data-dribbblish-rail-source-display", sourceDisplay.value);
	source.setAttribute("data-dribbblish-rail-source-display-priority", sourceDisplay.priority);
	source.style.setProperty("display", "none", "important");

	const sync = () => {
		button.className = source.className;
		button.classList.add("dribbblish-rail-button");
		button.disabled = source.disabled;
		for (const attribute of ["aria-current", "aria-label"]) {
			const value = source.getAttribute(attribute);
			if (value === null) button.removeAttribute(attribute);
			else button.setAttribute(attribute, value);
		}
		button.removeAttribute("id");
		button.replaceChildren(...[...source.childNodes].map((child) => child.cloneNode(true)));
		button.setAttribute("aria-describedby", tooltip.id);
		tooltip.textContent = source.getAttribute("aria-label") ?? "";
	};
	const positionTooltip = () => {
		const buttonRect = button.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const position = railTooltipPosition(
			buttonRect,
			tooltipRect,
			{ height: window.innerHeight, width: window.innerWidth },
			button.closest("#dribbblish-navlinks-rail")?.classList.contains("dribbblish-navlinks-rail--expanded") ??
				false,
		);
		tooltip.style.left = `${position.left}px`;
		tooltip.style.top = `${position.top}px`;
	};
	const repositionVisibleTooltip = () => {
		if (tooltip.hasAttribute("data-visible")) positionTooltip();
	};
	let buttonHovered = false;
	let buttonFocused = false;
	let tooltipHovered = false;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	const cancelHide = () => {
		if (hideTimer !== undefined) clearTimeout(hideTimer);
		hideTimer = undefined;
	};
	const showTooltip = () => {
		cancelHide();
		tooltip.setAttribute("data-visible", "");
		positionTooltip();
	};
	const hideTooltip = () => {
		cancelHide();
		tooltip.removeAttribute("data-visible");
	};
	const scheduleHide = () => {
		cancelHide();
		hideTimer = setTimeout(() => {
			hideTimer = undefined;
			if (!buttonHovered && !buttonFocused && !tooltipHovered) hideTooltip();
		}, 300);
	};
	const buttonPointerEnter = () => {
		buttonHovered = true;
		showTooltip();
	};
	const buttonPointerLeave = () => {
		buttonHovered = false;
		scheduleHide();
	};
	const buttonFocus = () => {
		buttonFocused = true;
		showTooltip();
	};
	const buttonBlur = () => {
		buttonFocused = false;
		scheduleHide();
	};
	const tooltipPointerEnter = () => {
		tooltipHovered = true;
		cancelHide();
	};
	const tooltipPointerLeave = () => {
		tooltipHovered = false;
		scheduleHide();
	};
	const dismissTooltip = (event: KeyboardEvent) => {
		if (event.key === "Escape") hideTooltip();
	};
	const forwardClick = () => source.click();
	button.addEventListener("click", forwardClick);
	button.addEventListener("pointerenter", buttonPointerEnter);
	button.addEventListener("pointerleave", buttonPointerLeave);
	button.addEventListener("focus", buttonFocus);
	button.addEventListener("blur", buttonBlur);
	button.addEventListener("keydown", dismissTooltip);
	tooltip.addEventListener("pointerenter", tooltipPointerEnter);
	tooltip.addEventListener("pointerleave", tooltipPointerLeave);
	source.after(button);
	const rail = button.closest("#dribbblish-navlinks-rail");
	const observer = new MutationObserver(sync);
	observer.observe(source, {
		attributes: true,
		attributeFilter: ["aria-current", "aria-label", "class", "disabled"],
		childList: true,
		subtree: true,
	});
	const railObserver = new MutationObserver(repositionVisibleTooltip);
	if (rail) railObserver.observe(rail, { attributes: true, attributeFilter: ["class"] });
	window.addEventListener("resize", repositionVisibleTooltip);
	sync();

	return {
		button,
		dispose: () => {
			observer.disconnect();
			railObserver.disconnect();
			cancelHide();
			window.removeEventListener("resize", repositionVisibleTooltip);
			button.removeEventListener("click", forwardClick);
			button.removeEventListener("pointerenter", buttonPointerEnter);
			button.removeEventListener("pointerleave", buttonPointerLeave);
			button.removeEventListener("focus", buttonFocus);
			button.removeEventListener("blur", buttonBlur);
			button.removeEventListener("keydown", dismissTooltip);
			tooltip.removeEventListener("pointerenter", tooltipPointerEnter);
			tooltip.removeEventListener("pointerleave", tooltipPointerLeave);
			button.remove();
			tooltip.remove();
			source.removeAttribute("data-dribbblish-rail-source");
			source.removeAttribute("data-dribbblish-rail-source-display");
			source.removeAttribute("data-dribbblish-rail-source-display-priority");
			if (sourceDisplay.value) source.style.setProperty("display", sourceDisplay.value, sourceDisplay.priority);
			else source.style.removeProperty("display");
		},
	};
}

export function removeStaleRailMirrors(root: ParentNode) {
	root.querySelectorAll(".dribbblish-rail-button").forEach((button) => button.remove());
	document.querySelectorAll(".dribbblish-rail-tooltip").forEach((tooltip) => tooltip.remove());
	root.querySelectorAll<HTMLElement>("[data-dribbblish-rail-source]").forEach((source) => {
		const display = source.getAttribute("data-dribbblish-rail-source-display") ?? "";
		const priority = source.getAttribute("data-dribbblish-rail-source-display-priority") ?? "";
		source.removeAttribute("data-dribbblish-rail-source");
		source.removeAttribute("data-dribbblish-rail-source-display");
		source.removeAttribute("data-dribbblish-rail-source-display-priority");
		if (display) source.style.setProperty("display", display, priority);
		else source.style.removeProperty("display");
	});
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
