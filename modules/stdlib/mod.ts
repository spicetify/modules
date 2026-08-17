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
export * from "./src/client.ts";
export * from "./src/events.ts";
// Vanilla component kit for module-owned DOM (React-free).
export * from "./lib/primitives-vanilla.ts";
export * from "./src/storage.ts";
export * from "./src/wpunpk.ts";
export * from "./src/logger.ts";
export { display as displayModal, hide as hideModal, type ModalOptions } from "./lib/modal.tsx";
export { React, ReactDOM, ReactDOMServer } from "./src/expose/React.ts";
export { Platform } from "./src/expose/Platform.ts";
export { createIconComponent } from "./src/createIconComponent.tsx";
export { startCase } from "./deps.ts";

// Palette Manager needs the client's Color constructor and its companion
// type. Export that semantic capability without exposing the webpack module.
export { Color } from "./src/webpack/misc.xpui.ts";
