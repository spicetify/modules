/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runtime context the v3 loader passes into preload/load.
export interface ModuleRuntimeContext {
	spotifyVersion: string;
	identifier: string;
	defer: (fn: () => void | Promise<void>) => void;
}

export * from "./src/registers/index.ts";
export * from "./src/events.ts";
export * from "./src/storage.ts";
export * from "./src/wpunpk.ts";
export * from "./src/logger.ts";

// Public barrel: everything dependent modules are allowed to deep-import.
// Import from /modules/stdlib/mod.js at runtime; nothing else is public.
export * from "./src/webpack/misc.xpui.ts";
export * from "./src/webpack/ComponentLibrary.xpui.ts";
export * from "./src/webpack/ReactComponents.xpui.ts";
