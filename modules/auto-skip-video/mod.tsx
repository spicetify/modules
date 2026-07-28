/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Auto Skip Video"
 * extension by khanhas.
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { MenuItem } from "/modules/stdlib/lib/primitives.js";
import { closeMenu, openedFromProfileMenu, useMenuItem } from "/modules/stdlib/src/registers/menu.ts";

const KEY = "spicetify:auto-skip-video";
// On by default, matching the classic extension's always-on behaviour; the
// stored flag only records the opt-out.
const isEnabled = () => localStorage.getItem(KEY) !== "0";

// A toggle in the profile menu (the menu register + the profile-menu
// discriminator). It self-subscribes with a force-render so the label
// reflects the flag immediately.
const ToggleItem = () => {
	const ctx = useMenuItem();
	const [, force] = React.useReducer((n: number) => n + 1, 0);
	if (!openedFromProfileMenu(ctx)) return null;
	return (
		<MenuItem
			onClick={() => {
				localStorage.setItem(KEY, isEnabled() ? "0" : "1");
				force();
				closeMenu();
			}}
		>
			Auto-skip videos: {isEnabled() ? "on" : "off"}
		</MenuItem>
	);
};

// Video media plays as media.type "video"; ads are also video, so exclude
// them (the client handles ads, and skipping them here does nothing useful).
const isSkippableVideo = (item: any): boolean => {
	const meta = item?.metadata ?? {};
	return meta["media.type"] === "video" && meta.is_advertisement !== "true";
};

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register("menu", <ToggleItem />);

	// Skip the current track when it is a (non-ad) video and the toggle is on.
	// Self-subscribe to the player and dispose the listener on unload.
	const onSongChange = () => {
		if (!isEnabled()) return;
		if (isSkippableVideo(Spicetify?.Player?.data?.item)) Spicetify?.Player?.next?.();
	};
	Spicetify?.Player?.addEventListener("songchange", onSongChange);
	ctx.defer(() => Spicetify?.Player?.removeEventListener("songchange", onSongChange));
}
