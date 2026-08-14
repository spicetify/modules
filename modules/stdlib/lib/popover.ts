/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Anchored popover: positions content in a floating panel under a trigger
// element (topbar buttons, playbar buttons, ...) and owns dismissal —
// click-outside, Escape, and reposition on resize. Content can be a React
// node (rendered with the client React) or a plain HTMLElement, so vanilla
// modules can use it without touching React.

import { React, ReactDOM } from "../src/expose/React.ts";
import { calculateFloatingPosition } from "./floating-position.ts";

export interface PopoverHandle {
	close: () => void;
	host: HTMLElement;
}

export interface PopoverOptions {
	anchor: HTMLElement;
	content: HTMLElement | React.ReactNode;
	onClose?: () => void;
	gap?: number;
}

export function openPopover({ anchor, content, onClose, gap = 8 }: PopoverOptions): PopoverHandle {
	const host = document.createElement("div");
	host.className = "spicetify-popover";
	host.style.visibility = "hidden";

	const place = () => {
		if (!anchor.isConnected || !host.isConnected) return;
		const position = calculateFloatingPosition(
			anchor.getBoundingClientRect(),
			host.getBoundingClientRect(),
			{ width: window.innerWidth, height: window.innerHeight },
			{ align: "start", gap },
		);
		host.style.left = `${position.left}px`;
		host.style.top = `${position.top}px`;
		host.style.visibility = "visible";
		host.dataset.placement = position.placement;
	};

	let root: ReturnType<typeof ReactDOM.createRoot> | undefined;
	if (content instanceof HTMLElement) {
		host.appendChild(content);
	} else {
		root = ReactDOM.createRoot(host);
		root.render(React.createElement(React.Fragment, null, content));
	}
	const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);

	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		window.removeEventListener("resize", place);
		document.removeEventListener("scroll", place, true);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKey, true);
		resizeObserver?.disconnect();
		root?.unmount();
		host.remove();
		onClose?.();
	};
	const onDocDown = (e: MouseEvent) => {
		const target = e.target as Node;
		if (!host.contains(target) && !anchor.contains(target)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.preventDefault();
		e.stopPropagation();
		close();
	};

	document.body.appendChild(host);
	place();
	// A second pass once layout has produced the real width, for clamping.
	requestAnimationFrame(place);
	window.addEventListener("resize", place);
	document.addEventListener("scroll", place, true);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKey, true);
	resizeObserver?.observe(anchor);
	resizeObserver?.observe(host);

	return { close, host };
}
