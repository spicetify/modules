/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported from veryboringhwl's `adblock` module (MIT).
 */

import { client, createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { SettingsToggleRow } from "/modules/stdlib/lib/primitives.js";
import {
	AD_FETCHERS,
	AD_MANAGERS,
	AD_SURFACE_CSS,
	blockAdSlots,
	createAdSettingsClient,
	disableManager,
	enableManager,
	injectStyle,
	isAdItem,
	resolveManager,
	REMOTE_CONFIG_OVERRIDES,
	skipAd,
	stubFetcher,
	UPSELL_CSS,
} from "./logic.ts";

const STORAGE_KEY = "adblock:enabled";
const UPSELL_KEY = "adblock:hideUpsells";
const UPSELL_STYLE_ID = "spicetify-adblock-upsells";
const AD_STYLE_ID = "spicetify-adblock-surfaces";
const AD_PLAYING_CLASS = "spicetify-adblock-ad-playing";

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);

	const managers = (): Record<string, any> => client.platform?.AdManagers ?? {};

	// Remembers which surfaces this module actually turned off, so unloading
	// restores the client rather than force-enabling things the user's account
	// never had.
	let disabled: string[] = [];

	// Restorers for the fetch-driven surfaces, kept separate because those are
	// put back by handing the original function back rather than by re-enabling.
	let unstub: (() => void)[] = [];

	let onSongChange: ((event: unknown) => void) | null = null;

	let removeAdStyle: (() => void) | null = null;
	let restoreAdSlots: (() => Promise<void>) | null = null;
	let adSlotTransition = Promise.resolve();

	const setAdSlotBlocking = (value: boolean): Promise<void> => {
		adSlotTransition = adSlotTransition
			.then(async () => {
				if (restoreAdSlots) {
					const restore = restoreAdSlots;
					restoreAdSlots = null;
					await restore();
				}
				if (!value) return;

				const connector = managers().audio?.inStreamApi?.adsCoreConnector;
				const settings = createAdSettingsClient(
					globalThis.__webpack_require__ as Parameters<typeof createAdSettingsClient>[0],
					client.platform as Parameters<typeof createAdSettingsClient>[1],
				);
				if (!connector || !settings) {
					console.warn("[adblock] ad-slot services are unavailable in this Spotify build");
					return;
				}
				restoreAdSlots = await blockAdSlots(connector, settings);
			})
			.catch((error) => console.warn("[adblock] ad-slot transition failed", error));
		return adSlotTransition;
	};

	const applyBlocking = () => {
		for (const path of AD_MANAGERS) {
			if (disableManager(resolveManager(managers(), path) as never) && !disabled.includes(path)) {
				disabled.push(path);
			}
		}
		if (unstub.length === 0) {
			for (const { path, method } of AD_FETCHERS) {
				const restorer = stubFetcher(resolveManager(managers(), path) as never, method);
				if (restorer) unstub.push(restorer);
			}
		}
		removeAdStyle ??= injectStyle(AD_STYLE_ID, AD_SURFACE_CSS);
		void setAdSlotBlocking(true);
	};

	const restore = async () => {
		stopSkipping();
		removeAdStyle?.();
		removeAdStyle = null;
		await setAdSlotBlocking(false);
		if (enabled) return;
		for (const path of disabled) enableManager(resolveManager(managers(), path) as never);
		disabled = [];
		for (const restorer of unstub) restorer();
		unstub = [];
	};

	// Older clients still expose an override skip. Keep it as a fallback while
	// current clients are protected before inventory reaches the player.
	const skipIfAd = () => {
		const adPlaying = enabled && isAdItem(client.player?.data?.item);
		document.documentElement.classList.toggle(AD_PLAYING_CLASS, adPlaying);
		if (!adPlaying) return;
		void skipAd(managers().audio?.inStreamApi?.adsCoreConnector);
	};

	const startSkipping = () => {
		stopSkipping();
		onSongChange = () => skipIfAd();
		client.player?.addEventListener?.("songchange", onSongChange);
		skipIfAd();
	};

	const stopSkipping = () => {
		if (onSongChange) client.player?.removeEventListener?.("songchange", onSongChange);
		onSongChange = null;
		document.documentElement.classList.remove(AD_PLAYING_CLASS);
	};

	// Upsell chrome is remote-config gated rather than manager-owned. A failure
	// here must not take the rest of the module down.
	const applyRemoteConfig = async () => {
		const api = client.platform?.RemoteConfigDebugAPI;
		if (typeof api?.setOverride !== "function") return;
		for (const [name, value] of Object.entries(REMOTE_CONFIG_OVERRIDES)) {
			try {
				await api.setOverride({ source: "web", type: "boolean", name }, value);
			} catch (error) {
				console.warn(`[adblock] could not override ${name}`, error);
			}
		}
	};

	const readEnabled = (): boolean => client.storage.get(STORAGE_KEY) !== "false";
	let enabled = readEnabled();

	let removeUpsellStyle: (() => void) | null = null;
	let hideUpsells = client.storage.get(UPSELL_KEY) !== "false";

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
				client.storage.set(STORAGE_KEY, String(value));
				if (value) {
					applyBlocking();
					startSkipping();
					void applyRemoteConfig();
				} else {
					void restore();
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
				client.storage.set(UPSELL_KEY, String(value));
				applyUpsells(value);
			}}
		/>,
	);

	ctx.defer(async () => {
		enabled = false;
		await restore();
		removeUpsellStyle?.();
		removeUpsellStyle = null;
	});
}
