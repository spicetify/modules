/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { MenuItem } from "/modules/stdlib/lib/primitives.js";
import { closeMenu, openedFromProfileMenu, useMenuItem } from "/modules/stdlib/src/registers/menu.ts";

import { STORAGE_KEY, shouldHide } from "./logic.ts";

const isEnabled = () => shouldHide(localStorage.getItem(STORAGE_KEY));

// The DesktopUpdateUi service is the shell's own bridge for the native window
// chrome; showButtons:false removes the macOS traffic lights (and the shell's
// window buttons on other platforms, where the shell draws them).
const setButtonsVisible = async (visible: boolean) => {
	const client = Spicetify.Platform?.ControlMessageAPI?._updateUiClient;
	await client?.setButtonsVisibility?.({ showButtons: visible });
};

// --global-nav-margin-top is the text theme's documented hook for the space
// it reserves under the traffic lights; unused by other themes, so setting
// it is harmless there.
const apply = async (hidden: boolean) => {
	await setButtonsVisible(!hidden);
	const style = document.documentElement.style;
	if (hidden) style.setProperty("--global-nav-margin-top", "0px");
	else style.removeProperty("--global-nav-margin-top");
};

const ToggleItem = ({ onToggle }: { onToggle: (enabled: boolean) => void }) => {
	const ctx = useMenuItem();
	const [, force] = React.useReducer((n: number) => n + 1, 0);
	if (!openedFromProfileMenu(ctx)) return null;
	return (
		<MenuItem
			onClick={() => {
				const enabled = !isEnabled();
				localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
				onToggle(enabled);
				force();
				closeMenu();
			}}
		>
			Hide window controls: {isEnabled() ? "on" : "off"}
		</MenuItem>
	);
};

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register("menu", <ToggleItem onToggle={(enabled) => void apply(enabled)} />);

	if (isEnabled()) await apply(true);
	ctx.defer(() => {
		if (isEnabled()) void apply(false);
	});
}
