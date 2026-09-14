/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const placeMenuItemsHost = (menu: Element, host: HTMLElement): void => {
	const settingsRow = Array.from(menu.children).find(
		(child) => child.matches('a[href="/preferences"]') || child.querySelector('a[href="/preferences"]'),
	);

	if (settingsRow) {
		if (settingsRow.nextElementSibling !== host) settingsRow.after(host);
		return;
	}

	if (host.parentElement !== menu) menu.append(host);
};
