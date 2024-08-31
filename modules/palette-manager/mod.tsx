/* Copyright (C) 2024 harbassan, and Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";

import { React } from "/modules/stdlib/src/expose/React.ts";

import type { ModuleInstance } from "/hooks/index.ts";
import { Color } from "/modules/stdlib/src/webpack/misc.ts";

export default async function (mod: ModuleInstance) {
	const registrar = createRegistrar(mod);

	const { EditButton } = await import("./paletteManager.tsx");

	registrar.register("topbarLeftButton", <EditButton />);

	const { createSchemer } = await import("./schemer.ts");

	createSchemer(mod)
		.register("Spicetify", {
			text: Color.fromHex("#ffffff"),
			subtext: Color.fromHex("#c0b4b4"),
			base: Color.fromHex("#0a0a0f"),
			main: Color.fromHex("#0F111A"),
			main_elevated: Color.fromHex("#1b1e2c"),
			highlight: Color.fromHex("#1b1e2c"),
			highlight_elevated: Color.fromHex("#1b1e2c"),
			card: Color.fromHex("#0a0a0f"),
			button: Color.fromHex("#FF4151"),
			button_active: Color.fromHex("#ff5c69"),
			notification: Color.fromHex("#33bacc"),
			tab: Color.fromHex("#c0b4b4"),
			tab_active: Color.fromHex("#FF4151"),
			playbar: Color.fromHex("#c0b4b4"),
			playbar_active: Color.fromHex("#FF4151"),
		}).register("Nord", {
			text: Color.fromHex("#eceff4"),
			subtext: Color.fromHex("#d8dee9"),
			base: Color.fromHex("#23272f"),
			main: Color.fromHex("#2e3440"),
			main_elevated: Color.fromHex("#3b4252"),
			highlight: Color.fromHex("#3b4252"),
			highlight_elevated: Color.fromHex("#434c5e"),
			card: Color.fromHex("#2e3440"),
			button: Color.fromHex("#8fbcbb"),
			button_active: Color.fromHex("#9fcbca"),
			notification: Color.fromHex("#88c0d0"),
			tab: Color.fromHex("#d8dee9"),
			tab_active: Color.fromHex("#81a1c1"),
			playbar: Color.fromHex("#81a1c1"),
			playbar_active: Color.fromHex("#8fbcbb"),
		});
}
