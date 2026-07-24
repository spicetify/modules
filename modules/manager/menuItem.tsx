/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "/modules/stdlib/src/expose/React.ts";
import { Platform } from "/modules/stdlib/src/expose/Platform.ts";
import { closeMenu, openedFromProfileMenu, useMenuItem } from "/modules/stdlib/src/registers/menu.ts";

export const MANAGER_ROUTE = "/bespoke/manager";

export const SpicetifyMenuItem = () => {
	const ctx = useMenuItem();
	if (!openedFromProfileMenu(ctx)) return null;

	return (
		<button
			type="button"
			role="menuitem"
			className="main-contextMenu-menuItemButton spicetify-manager-menu-item"
			onClick={() => {
				Platform.getHistory().push(MANAGER_ROUTE);
				closeMenu();
			}}
		>
			<span>Spicetify Settings</span>
		</button>
	);
};
