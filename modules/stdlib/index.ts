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

export async function load(ctx: { spotifyVersion: string }) {
	return (await import("./load.js")).default(ctx);
}
