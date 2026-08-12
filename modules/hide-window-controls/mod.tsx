/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { client, createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { SettingsToggleRow } from "/modules/stdlib/lib/primitives.js";

import { STORAGE_KEY, shouldHide } from "./logic.ts";

const isEnabled = () => shouldHide(localStorage.getItem(STORAGE_KEY));

// The DesktopUpdateUi service is the shell's own bridge for the native window
// chrome; showButtons:false removes the macOS traffic lights (and the shell's
// window buttons on other platforms, where the shell draws them).
const setButtonsVisible = async (visible: boolean) => {
	const updateUiClient = client.platform?.ControlMessageAPI?._updateUiClient;
	await updateUiClient?.setButtonsVisibility?.({ showButtons: visible });
};

// The client parks an empty 52px div at the head of the nav's history buttons
// so the macOS traffic lights have somewhere to sit. Hiding the lights leaves
// it behind as a hole at the top left, with the back and forward buttons
// starting 106px in from the edge for no reason anyone can see.
//
// Keyed on :empty and on the css-map name of the wrapper rather than the
// spacer's own class, which is a per-build hash. If the client ever puts
// something in that slot the rule stops matching instead of crushing it.
const SPACER_CSS = `.spotify__os--is-macos .main-globalNav-historyButtonsWrapper > div:first-child:empty {
	width: 0 !important;
}`;

const SPACER_STYLE_ID = "spicetify-hide-window-controls-spacer";

const setSpacerCollapsed = (collapsed: boolean) => {
	const existing = document.getElementById(SPACER_STYLE_ID);
	if (!collapsed) {
		existing?.remove();
		return;
	}
	if (existing) return;
	const style = document.createElement("style");
	style.id = SPACER_STYLE_ID;
	style.textContent = SPACER_CSS;
	document.head.appendChild(style);
};

// --global-nav-margin-top is the text theme's documented hook for the space
// it reserves under the traffic lights; unused by other themes, so setting
// it is harmless there.
const apply = async (hidden: boolean) => {
	await setButtonsVisible(!hidden);
	const style = document.documentElement.style;
	if (hidden) style.setProperty("--global-nav-margin-top", "0px");
	else style.removeProperty("--global-nav-margin-top");
	setSpacerCollapsed(hidden);
};

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register(
		"settingsRow",
		<SettingsToggleRow
			label="Hide window controls"
			getValue={isEnabled}
			onChange={(enabled) => {
				localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
				void apply(enabled);
			}}
		/>,
	);

	if (isEnabled()) await apply(true);
	ctx.defer(() => {
		if (isEnabled()) void apply(false);
	});
}
