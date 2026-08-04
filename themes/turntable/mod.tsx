/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Turntable" theme by
 * Grason Chan.
 *
 * The classic script also decorated the full-app-display overlay with a
 * heart button, artist/album glyphs and a blur-backdrop toggle. The v3
 * full-app-display module renders the heart and the glyphs itself, and the
 * toggle hung off PopupModal methods that no longer exist, so only the
 * record rotation remains.
 */

import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

const SPINNING_CLASS = "turntable-spinning";

export default async function (ctx: ModuleRuntimeContext) {
	const setSpinning = (spinning: boolean) => document.documentElement.classList.toggle(SPINNING_CLASS, spinning);

	const onPlayPause = () => setSpinning(Spicetify.Player.isPlaying());
	Spicetify.Player.addEventListener("onplaypause", onPlayPause);
	onPlayPause();

	ctx.defer(() => {
		Spicetify.Player.removeEventListener("onplaypause", onPlayPause);
		document.documentElement.classList.remove(SPINNING_CLASS);
	});
}
