/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mix.ts";

export type SettingsSectionProps = { filterMatchQuery: string; };
export type SettingsSection = React.FC<SettingsSectionProps>;
export let SettingsSection: SettingsSection;

export const future = {
	push: () => { },
	pull(fn: () => void) {
		const push = this.push;
		this.push = () => {
			push();
			fn();
		};
	},
};

export type SettingsSectionTitleProps = {};
export type SettingsSectionTitle = React.FC<SettingsSectionTitleProps>;
export let SettingsSectionTitle: SettingsSectionTitle;

transformer<SettingsSection>(
	(emit) => (str) => {
		str = str.replace(
			/(\.jsxs\)\()([a-zA-Z_\$][\w\$]*)([^=]*"desktop.settings.compatibility")/,
			"$1(__SettingsSection=$2)$3",
		);
		Object.defineProperty(globalThis, "__SettingsSection", { set: emit });
		return str;
	},
	{
		glob: /^\/xpui-routes-desktop-settings\.js/,
		wait: false,
	},
).then(($) => {
	SettingsSection = $;
	future.push();
});

transformer<SettingsSectionTitle>(
	(emit) => (str) => {
		str = str.replace(
			/("desktop.settings.compatibility"[^=]*?\.jsx\)\()([a-zA-Z_\$][\w\$]*)/,
			"$1(__SettingsSectionTitle=$2)",
		);
		Object.defineProperty(globalThis, "__SettingsSectionTitle", { set: emit });
		return str;
	},
	{
		glob: /^\/xpui-routes-desktop-settings\.js/,
		wait: false,
	},
).then(($) => {
	SettingsSectionTitle = $;
});
