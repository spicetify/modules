/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
	closeMenu,
	openedFromProfileMenu,
	Platform,
	SPICETIFY_SETTINGS_ROUTE,
	useMenuItem,
} from "/modules/stdlib/mod.ts";
import { MenuItem } from "/modules/stdlib/lib/primitives.js";

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
