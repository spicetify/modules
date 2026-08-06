/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Christian Spotify"
 * extension by khanhas.
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { SettingsToggleRow } from "/modules/stdlib/lib/primitives.js";

import { isExplicit } from "./logic.ts";

const KEY = "spicetify:auto-skip-explicit";
const isEnabled = () => localStorage.getItem(KEY) === "1";

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register(
		"settingsRow",
		<SettingsToggleRow
			label="Auto-skip explicit tracks"
			getValue={isEnabled}
			onChange={(enabled) => localStorage.setItem(KEY, enabled ? "1" : "0")}
		/>,
	);

	// Skip the current track when it is explicit and the toggle is on.
	// Self-subscribe to the player and dispose the listener on unload.
	const onSongChange = () => {
		if (!isEnabled()) return;
		if (isExplicit(Spicetify?.Player?.data?.item)) Spicetify?.Player?.next?.();
	};
	Spicetify?.Player?.addEventListener("songchange", onSongChange);
	ctx.defer(() => Spicetify?.Player?.removeEventListener("songchange", onSongChange));
}
