/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported from veryboringhwl's `adblock` module (MIT).
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { SettingsRow, SettingsSection, Toggle } from "/modules/stdlib/lib/primitives.tsx";
import { AD_MANAGERS, disableManager, enableManager, REMOTE_CONFIG_OVERRIDES } from "./logic.ts";

const STORAGE_KEY = "adblock:enabled";

export default async function (ctx: ModuleRuntimeContext) {
	const { useState } = React;
	const registrar = createRegistrar(ctx);

	const managers = (): Record<string, any> => Spicetify.Platform?.AdManagers ?? {};

	// Remembers which surfaces this module actually turned off, so unloading
	// restores the client rather than force-enabling things the user's account
	// never had.
	let disabled: string[] = [];

	const applyBlocking = () => {
		disabled = AD_MANAGERS.filter((name) => disableManager(managers()[name]));
	};

	const restore = () => {
		for (const name of disabled) enableManager(managers()[name]);
		disabled = [];
	};

	// Upsell chrome is remote-config gated rather than manager-owned. A failure
	// here must not take the rest of the module down: the managers are what
	// actually stop playback ads.
	const applyRemoteConfig = async () => {
		const api = Spicetify.Platform?.RemoteConfigDebugAPI;
		if (typeof api?.setOverride !== "function") return;
		for (const [name, value] of Object.entries(REMOTE_CONFIG_OVERRIDES)) {
			try {
				await api.setOverride({ source: "web", type: "boolean", name }, value);
			} catch (error) {
				console.warn(`[adblock] could not override ${name}`, error);
			}
		}
	};

	const readEnabled = (): boolean => Spicetify.LocalStorage.get(STORAGE_KEY) !== "false";
	let enabled = readEnabled();

	if (enabled) {
		applyBlocking();
		void applyRemoteConfig();
	}

	function Settings() {
		const [on, setOn] = useState(enabled);
		return (
			<SettingsSection title="Adblock">
				<SettingsRow label="Block ad surfaces">
					<Toggle
						value={on}
						onChange={(value) => {
							setOn(value);
							enabled = value;
							Spicetify.LocalStorage.set(STORAGE_KEY, String(value));
							if (value) {
								applyBlocking();
								void applyRemoteConfig();
							} else {
								restore();
							}
						}}
					/>
				</SettingsRow>
			</SettingsSection>
		);
	}

	registrar.register("settingsSection", <Settings />);

	ctx.defer(() => {
		restore();
	});
}
