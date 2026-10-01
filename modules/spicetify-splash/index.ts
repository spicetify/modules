/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { showSplash } from "./splash.ts";

let splash: ReturnType<typeof showSplash> | undefined;

export function mixin() {
	splash?.dispose();
	splash = showSplash();
}

export async function load(ctx: ModuleRuntimeContext) {
	if (splash) {
		const current = splash;
		ctx.defer(current.dispose);
		const { client } = await import("/modules/stdlib/mod.ts");
		current.watchReady(() => !!document.querySelector("main") && !!client.modules);
	}
	await (await import("./mod.js")).default(ctx);
}
