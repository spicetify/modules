/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface AnchorRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface SurfaceSize {
	width: number;
	height: number;
}

export interface ViewportSize {
	width: number;
	height: number;
}

export interface FloatingPositionOptions {
	align: "center" | "start";
	gap: number;
	margin?: number;
}

export interface FloatingPosition {
	left: number;
	top: number;
	placement: "above" | "below";
}

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export function calculateFloatingPosition(
	anchor: AnchorRect,
	surface: SurfaceSize,
	viewport: ViewportSize,
	options: FloatingPositionOptions,
): FloatingPosition {
	const margin = options.margin ?? 8;
	const spaceBelow = viewport.height - anchor.bottom - margin;
	const spaceAbove = anchor.top - margin;
	const placement = spaceBelow >= surface.height + options.gap || spaceBelow >= spaceAbove ? "below" : "above";
	const desiredTop = placement === "below" ? anchor.bottom + options.gap : anchor.top - options.gap - surface.height;
	const anchorCenter = anchor.left + (anchor.right - anchor.left) / 2;
	const desiredLeft = options.align === "center" ? anchorCenter - surface.width / 2 : anchor.left;

	return {
		left: Math.round(clamp(desiredLeft, margin, viewport.width - surface.width - margin)),
		top: Math.round(clamp(desiredTop, margin, viewport.height - surface.height - margin)),
		placement,
	};
}
