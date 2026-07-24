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
	Object.assign(host.style, {
		position: "fixed",
		zIndex: "1000",
		background: "var(--spice-card, var(--background-elevated-base, #282828))",
		color: "var(--spice-text, var(--text-base, #fff))",
		borderRadius: "8px",
		boxShadow: "0 16px 24px rgba(0, 0, 0, 0.3), 0 6px 8px rgba(0, 0, 0, 0.2)",
		maxHeight: "80vh",
		overflow: "auto",
	});

	const place = () => {
		const rect = anchor.getBoundingClientRect();
		host.style.top = `${Math.round(Math.min(rect.bottom + gap, window.innerHeight - 64))}px`;
		const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - host.offsetWidth - 8));
		host.style.left = `${Math.round(left)}px`;
	};

	let root: { unmount: () => void } | undefined;
	if (content instanceof HTMLElement) {
		host.appendChild(content);
	} else {
		const createRoot = (ReactDOM as any).createRoot;
		root = createRoot(host);
		(root as any).render(React.createElement(React.Fragment, null, content as any));
	}

	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		window.removeEventListener("resize", place);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKey, true);
		root?.unmount();
		host.remove();
		onClose?.();
	};
	const onDocDown = (e: MouseEvent) => {
		const target = e.target as Node;
		if (!host.contains(target) && !anchor.contains(target)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") close();
	};

	document.body.appendChild(host);
	place();
	// A second pass once layout has produced the real width, for clamping.
	requestAnimationFrame(place);
	window.addEventListener("resize", place);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKey, true);

	return { close, host };
}
