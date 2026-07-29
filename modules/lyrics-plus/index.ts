/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "lyrics-plus" custom app.
 */

import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

export async function load(ctx: ModuleRuntimeContext) {
	return (await import("./mod.js")).default(ctx);
}
