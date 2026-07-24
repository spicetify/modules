/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "/modules/stdlib/src/expose/React.ts";
import { Platform } from "/modules/stdlib/src/expose/Platform.ts";
import { useMenuItem } from "/modules/stdlib/src/registers/menu.ts";

export const MANAGER_ROUTE = "/bespoke/manager";

// The profile menu is the only click-opened menu whose trigger button
// carries the account image; 1.2.94 dropped the user-widget-link testid,
// so the image is the discriminator.
const openedFromAvatar = (target: HTMLElement | null): boolean => {
	const button = target?.closest?.("button");
	return !!button?.querySelector("img, figure");
};

export const SpicetifyMenuItem = () => {
	const ctx = useMenuItem();
	if (!ctx || ctx.trigger !== "click" || !openedFromAvatar(ctx.target)) return null;

	return (
		<button
			type="button"
			role="menuitem"
			className="main-contextMenu-menuItemButton spicetify-manager-menu-item"
			onClick={() => {
				Platform.getHistory().push(MANAGER_ROUTE);
				// The menu only dismisses on an outside press; native items
				// close through a context this foreign item does not have.
				setTimeout(() => {
					document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
				}, 0);
			}}
		>
			<span>Spicetify Settings</span>
		</button>
	);
};
