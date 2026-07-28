/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

export async function load(ctx: ModuleRuntimeContext) {
	return (await import("./mod.js")).default(ctx);
}
