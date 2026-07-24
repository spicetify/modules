/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";

import { ManagerPage } from "./page.tsx";
import { ManagerSection, MANAGER_ROUTE } from "./section.tsx";

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);

	registrar.register("settingsSection", <ManagerSection />);
	registrar.register(
		"route",
		React.createElement("route", { path: MANAGER_ROUTE, element: <ManagerPage /> }),
	);
}
