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
import { AD_MANAGERS, disableManager, enableManager, isAdItem, REMOTE_CONFIG_OVERRIDES, skipAd } from "./logic.ts";

const STORAGE_KEY = "adblock:enabled";

export default async function (ctx: ModuleRuntimeContext) {
	const { useState } = React;
	const registrar = createRegistrar(ctx);

	const managers = (): Record<string, any> => Spicetify.Platform?.AdManagers ?? {};

	// Remembers which surfaces this module actually turned off, so unloading
	// restores the client rather than force-enabling things the user's account
	// never had.
	let disabled: string[] = [];

	let onSongChange: ((event: unknown) => void) | null = null;

	const applyBlocking = () => {
		for (const name of AD_MANAGERS) {
			if (disableManager(managers()[name]) && !disabled.includes(name)) disabled.push(name);
		}
	};

	const restore = () => {
		stopSkipping();
		for (const name of disabled) enableManager(managers()[name]);
		disabled = [];
	};

	// Ads play as ordinary queue items, so the only thing that stops one is
	// moving past it as soon as it starts.
	const skipIfAd = () => {
		if (!enabled) return;
		if (!isAdItem(Spicetify.Player?.data?.item)) return;
		void skipAd(managers().audio?.inStreamApi?.adsCoreConnector);
	};

	const startSkipping = () => {
		stopSkipping();
		onSongChange = () => skipIfAd();
		Spicetify.Player?.addEventListener?.("songchange", onSongChange);
		skipIfAd();
	};

	const stopSkipping = () => {
		if (onSongChange) Spicetify.Player?.removeEventListener?.("songchange", onSongChange);
		onSongChange = null;
	};

	// Upsell chrome is remote-config gated rather than manager-owned. A failure
	// here must not take the rest of the module down.
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
		startSkipping();
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
								startSkipping();
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
