/*
 * Copyright (C) 2024 harbassan, and Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

export async function preload(ctx: ModuleRuntimeContext) {
	return await (await import("./palette.js")).default(ctx);
}

export async function load(ctx: ModuleRuntimeContext) {
	return await (await import("./mod.js")).default(ctx);
}
