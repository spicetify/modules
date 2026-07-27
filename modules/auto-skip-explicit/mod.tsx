/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Christian Spotify"
 * extension by khanhas.
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { closeMenu, openedFromProfileMenu, useMenuItem } from "/modules/stdlib/src/registers/menu.ts";

const Spicetify = (globalThis as { Spicetify?: any }).Spicetify;
const KEY = "spicetify:auto-skip-explicit";
const isEnabled = () => localStorage.getItem(KEY) === "1";

// A toggle in the profile menu (the menu register + the profile-menu
// discriminator). It self-subscribes with a force-render so the label
// reflects the flag immediately.
const ToggleItem = () => {
	const ctx = useMenuItem();
	const [, force] = React.useReducer((n: number) => n + 1, 0);
	if (!openedFromProfileMenu(ctx)) return null;
	return (
		<button
			type="button"
			role="menuitem"
			className="main-contextMenu-menuItemButton"
			onClick={() => {
				localStorage.setItem(KEY, isEnabled() ? "0" : "1");
				force();
				closeMenu();
			}}
		>
			<span>Auto-skip explicit: {isEnabled() ? "on" : "off"}</span>
		</button>
	);
};

const isExplicit = (item: any): boolean => {
	const flag = item?.metadata?.is_explicit ?? item?.isExplicit;
	return flag === "true" || flag === true;
};

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register("menu", <ToggleItem />);

	// Skip the current track when it is explicit and the toggle is on.
	// Self-subscribe to the player and dispose the listener on unload.
	const onSongChange = () => {
		if (!isEnabled()) return;
		if (isExplicit(Spicetify?.Player?.data?.item)) Spicetify?.Player?.next?.();
	};
	Spicetify?.Player?.addEventListener("songchange", onSongChange);
	ctx.defer(() => Spicetify?.Player?.removeEventListener("songchange", onSongChange));
}
