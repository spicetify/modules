/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRegistrar, Platform, React, type ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { Button, SettingsRow, SettingsSection } from "/modules/stdlib/lib/primitives.js";

import { ManagerPage } from "./page.tsx";
import { SpicetifyMenuItem, MANAGER_ROUTE } from "./menuItem.tsx";
import { captureHealthy, mountManagerFallback } from "./fallback.ts";

const ManagerSettingsAction = () => (
	<SettingsSection title="Module Manager">
		<SettingsRow label="Install, update, enable, and troubleshoot modules">
			<Button onClick={() => Platform.getHistory().push(MANAGER_ROUTE)}>Open Module Manager</Button>
		</SettingsRow>
	</SettingsSection>
);

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
	registrar.register("settingsAction", <ManagerSettingsAction />);
	registrar.registerRoute(MANAGER_ROUTE, <ManagerPage />);
}
