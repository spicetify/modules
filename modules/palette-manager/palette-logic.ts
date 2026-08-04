/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The client-free half of the palette domain: the CSS custom-property
// contract themes read, and the storage serialization saved palettes
// round-trip through. Both are compat surfaces - a silent format drift
// bricks every saved user palette - so they live here where node --test
// can pin them. The Color codec is injected: the real one is a
// webpack-captured client class.

export interface ColorLike {
	toCSS(format: unknown): string;
}

export type PaletteData = { id: string; name: string; colors: Record<string, string> };

// The variable names themes consume: snake_case keys become --spice-kebab.
export function formatCSSKey(key: string): string {
	return `--spice-${key.replaceAll("_", "-")}`;
}

export function paletteCSS(colors: Record<string, ColorLike>, format: unknown): string {
	return Object.entries(colors)
		.map(([k, v]) => `${formatCSSKey(k)}: ${v.toCSS(format)};`)
		.join(" ");
}

export function serializePalette(id: string, name: string, colors: Record<string, unknown>): PaletteData {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(colors)) {
		out[k] = JSON.stringify(v);
	}
	return { id, name, colors: out };
}

export function deserializeColors<C>(json: PaletteData, parse: (raw: string) => C): Record<string, C> {
	const colors: Record<string, C> = {};
	for (const [k, v] of Object.entries(json.colors)) {
		colors[k] = parse(v);
	}
	return colors;
}
