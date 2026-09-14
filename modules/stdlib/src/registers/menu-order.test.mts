/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../lib/test-setup.mts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { placeMenuItemsHost } from "./menu-order.ts";

const childIds = (menu: Element): string[] => Array.from(menu.children, (child) => child.id);

const buildProfileMenu = () => {
	document.body.innerHTML = `
		<ul role="menu">
			<li id="account"><button role="menuitem">Account</button></li>
			<li id="settings"><a role="menuitem" href="/preferences">Settings</a></li>
			<li id="logout"><button role="menuitem">Log out</button></li>
			<div id="updates">Your Updates</div>
		</ul>`;
	const menu = document.querySelector("[role='menu']")!;
	const host = document.createElement("li");
	host.id = "spicetify";
	host.className = "spicetify-menu-items";
	return { menu, host };
};

describe("menu item host placement", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("pins the host immediately after Spotify's native Settings row", () => {
		const { menu, host } = buildProfileMenu();

		placeMenuItemsHost(menu, host);

		assert.deepEqual(childIds(menu), ["account", "settings", "spicetify", "logout", "updates"]);
	});

	it("restores the pin when Spotify inserts content after Settings later", () => {
		const { menu, host } = buildProfileMenu();
		placeMenuItemsHost(menu, host);
		const late = document.createElement("li");
		late.id = "late";
		document.querySelector("#settings")!.after(late);

		placeMenuItemsHost(menu, host);

		assert.deepEqual(childIds(menu), ["account", "settings", "spicetify", "late", "logout", "updates"]);
	});

	it("keeps append behavior for context menus without Settings", () => {
		document.body.innerHTML = `<ul role="menu"><li id="native">Native item</li></ul>`;
		const menu = document.querySelector("[role='menu']")!;
		const host = document.createElement("li");
		host.id = "spicetify";

		placeMenuItemsHost(menu, host);

		assert.deepEqual(childIds(menu), ["native", "spicetify"]);
	});
});
