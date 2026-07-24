/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";

import { ManagerPage } from "./page.tsx";
import { SpicetifyMenuItem, MANAGER_ROUTE } from "./menuItem.tsx";

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);

	registrar.register("menu", <SpicetifyMenuItem />);
	registrar.registerRoute(MANAGER_ROUTE, <ManagerPage />);
}
