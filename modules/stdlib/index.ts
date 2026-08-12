/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Transformer } from "./mixin.ts";

// Lifecycle contract for the spicetify v3 modular loader (no /hooks).
export async function mixin(transformer: Transformer, ctx: { spotifyVersion: string }) {
	return (await import("./mixin.js")).default(transformer, ctx);
}

// The loader runs module lifecycles sequentially in dependency order. Holding
// stdlib's preload until its webpack analysis settles prevents every later UI
// module from observing half-populated React/component exports.
export async function preload() {
	const { waitForWebpackCapture } = await import("./src/webpack/index.js");
	await waitForWebpackCapture();
}

export async function load(ctx: { spotifyVersion: string }) {
	return (await import("./load.js")).default(ctx);
}
