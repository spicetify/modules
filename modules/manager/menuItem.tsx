/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Platform } from "/modules/stdlib/src/expose/Platform.ts";
import { SPICETIFY_SETTINGS_ROUTE } from "/modules/stdlib/mod.ts";
import { MenuItem } from "/modules/stdlib/lib/primitives.js";
import { closeMenu, openedFromProfileMenu, useMenuItem } from "/modules/stdlib/src/registers/menu.ts";

export const MANAGER_ROUTE = "/bespoke/manager";

export const SpicetifyMenuItem = () => {
	const ctx = useMenuItem();
	if (!openedFromProfileMenu(ctx)) return null;

	return (
		<MenuItem
			className="spicetify-manager-menu-item"
			onClick={() => {
				Platform.getHistory().push(SPICETIFY_SETTINGS_ROUTE);
				closeMenu();
			}}
		>
			Spicetify Settings
		</MenuItem>
	);
};
