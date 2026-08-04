/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";

import { ManagerPage } from "./page.tsx";
import { SpicetifyMenuItem, MANAGER_ROUTE } from "./menuItem.tsx";
import { captureHealthy, mountManagerFallback } from "./fallback.ts";

export default async function (ctx: ModuleRuntimeContext) {
	// Recovery tier (residual D5): with no usable React the route overlay -
	// and every module UI - cannot render, so mount the plain-DOM panel
	// instead of registering React surfaces that would only crash.
	if (!captureHealthy(React)) {
		ctx.defer(mountManagerFallback());
		return;
	}

	const registrar = createRegistrar(ctx);

	registrar.register("menu", <SpicetifyMenuItem />);
	registrar.registerRoute(MANAGER_ROUTE, <ManagerPage />);
}
