/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported from veryboringhwl's `adblock` module (MIT).
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { SettingsToggleRow } from "/modules/stdlib/lib/primitives.js";
import {
	AD_MANAGERS,
	disableManager,
	enableManager,
	injectStyle,
	isAdItem,
	REMOTE_CONFIG_OVERRIDES,
	skipAd,
	UPSELL_CSS,
} from "./logic.ts";

const STORAGE_KEY = "adblock:enabled";
const UPSELL_KEY = "adblock:hideUpsells";
const UPSELL_STYLE_ID = "spicetify-adblock-upsells";

export default async function (ctx: ModuleRuntimeContext) {
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

	let removeUpsellStyle: (() => void) | null = null;
	let hideUpsells = Spicetify.LocalStorage.get(UPSELL_KEY) !== "false";

	const applyUpsells = (value: boolean) => {
		removeUpsellStyle?.();
		removeUpsellStyle = value ? injectStyle(UPSELL_STYLE_ID, UPSELL_CSS) : null;
	};

	if (enabled) {
		applyBlocking();
		startSkipping();
		void applyRemoteConfig();
	}
	applyUpsells(hideUpsells);

	registrar.register(
		"settingsRow",
		<SettingsToggleRow
			label="Block ads"
			getValue={readEnabled}
			onChange={(value) => {
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
		/>,
	);

	registrar.register(
		"settingsRow",
		<SettingsToggleRow
			label="Hide upsell UI"
			getValue={() => hideUpsells}
			onChange={(value) => {
				hideUpsells = value;
				Spicetify.LocalStorage.set(UPSELL_KEY, String(value));
				applyUpsells(value);
			}}
		/>,
	);

	ctx.defer(() => {
		restore();
		removeUpsellStyle?.();
		removeUpsellStyle = null;
	});
}
