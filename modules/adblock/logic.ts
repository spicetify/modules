/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported from veryboringhwl's `adblock` module (MIT). His version drives
 * Spotify's Esperanto ad services, located by scanning webpack exports for a
 * SERVICE_ID. Manager-owned surfaces remain directly accessible through
 * `Platform.AdManagers`; inventory settings require the targeted lookup in
 * `slots.ts`.
 */

// Where each ad surface's disable actually lives. Some managers expose it
// directly, others keep it on a nested object, and the leaderboard names it
// `disableLeaderboard`. Addressing the outer object alone silently skips the
// nested ones: they have no `disable` and no `enabled`, so nothing happens and
// nothing reports a failure.
export const AD_MANAGERS = [
	"audio",
	"inStreamApi",
	"sponsoredPlaylist",
	"leaderboard",
	"hpto",
	"home",
	"survey",
	"vto.manager",
	"embeddedAd.embeddedAdManager",
	"embeddedPlaylist.embeddedPlaylistManager",
] as const;

// Surfaces whose ad is pulled by a fetch instead of gated by a flag. They carry
// neither `disable` nor `enabled`, so `disableManager` cannot touch them and
// returns false without anything reporting a failure — the same silent no-op as
// a nested manager addressed by its outer object. Overriding the fetch to
// resolve empty is what stops them; the client renders no card for an empty
// result and the leftover container collapses to zero height.
export const AD_FETCHERS = [{ path: "home", method: "fetchHomeAd" }] as const;

export { AD_SLOT_IDS, blockAdSlots, createAdSettingsClient, findWebpackServiceConstructor } from "./slots.ts";
export type { AdSlotConnector, AdSlotSettingsClient } from "./slots.ts";

/**
 * Replaces `method` on `manager` with one that resolves empty, returning a
 * restorer, or null when this build has no such method to stub.
 */
export function stubFetcher(manager: Record<string, any> | undefined, method: string): (() => void) | null {
	if (typeof manager?.[method] !== "function") return null;
	const original = manager[method];
	manager[method] = async () => null;
	return () => {
		manager[method] = original;
	};
}

/** Walks a dotted path, returning undefined rather than throwing on a gap. */
export function resolveManager(root: Record<string, any> | undefined, path: string): unknown {
	let node: any = root;
	for (const key of path.split(".")) {
		if (!node || typeof node !== "object") return undefined;
		node = node[key];
	}
	return node;
}

// Remote-config flags that gate upsell and ad chrome the managers do not own.
export const REMOTE_CONFIG_OVERRIDES: Record<string, boolean> = {
	enableInAppMessaging: false,
	hideUpgradeCTA: true,
	enablePremiumUserForMiniPlayer: true,
	enableHpto: false,
	enableSponsoredPlaylistV2: false,
};

type Manager = {
	enabled?: boolean;
	enable?: () => void;
	disable?: () => void;
	disableLeaderboard?: () => void;
	enableLeaderboard?: () => void;
	subscription?: { cancel?: () => void; unsubscribe?: () => void };
};

/** Whether a manager reports itself as on, tolerating a missing flag. */
export function isEnabled(manager: Manager | undefined): boolean {
	return manager?.enabled !== false;
}

/**
 * Turns one manager off and reports whether anything changed, so a caller can
 * restore exactly the surfaces it disabled. Prefers the client's own
 * `disable()` over writing the flag, since that is what unsubscribes.
 */
export function disableManager(manager: Manager | undefined): boolean {
	if (!manager) return false;
	const wasEnabled = isEnabled(manager);
	if (typeof manager.disable === "function") manager.disable();
	else if (typeof manager.disableLeaderboard === "function") manager.disableLeaderboard();
	else if ("enabled" in manager) manager.enabled = false;
	else return false;
	return wasEnabled;
}

export function enableManager(manager: Manager | undefined): void {
	if (!manager) return;
	if (typeof manager.enable === "function") manager.enable();
	else if (typeof manager.enableLeaderboard === "function") manager.enableLeaderboard();
	else if ("enabled" in manager) manager.enabled = true;
}

type PlayerItem = { uri?: string; type?: string; metadata?: Record<string, unknown> };

type CoreConnector = {
	skipToNextWithOverride?: (options: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Whether the player is on an advertisement.
 *
 * Ads arrive as ordinary queue items (`spotify:ad:…`, `type: "ad"`), which is
 * why disabling the ad managers does not stop them: those own the ad chrome
 * and reporting, not playback. Three independent tells are checked because a
 * client that renames one still gets caught by the others.
 */
export function isAdItem(item: PlayerItem | undefined | null): boolean {
	if (!item) return false;
	return (
		item.uri?.startsWith("spotify:ad:") === true || item.type === "ad" || item.metadata?.is_advertisement === "true"
	);
}

/**
 * Skips the ad currently playing, reporting whether the client accepted it.
 *
 * `Player.next()` is refused during an ad. Older clients exposed an ads
 * connector override, while current clients rely on preventive slot blocking.
 */
export async function skipAd(connector: CoreConnector | undefined): Promise<boolean> {
	if (typeof connector?.skipToNextWithOverride !== "function") return false;
	try {
		await connector.skipToNextWithOverride({});
		return true;
	} catch (error) {
		console.warn("[adblock] could not skip an ad", error);
		return false;
	}
}

/**
 * CSS that hides Spotify's upgrade prompts.
 *
 * Anchored on where a premium link points rather than on class names, which
 * are hashed and change between builds. The list item is hidden along with the
 * link so a menu does not keep a blank row where the entry was.
 *
 * This hides upsell chrome only. It does not tell the client the account is
 * premium: the capability keys (`player-license`, `offline`, `audio-quality`)
 * are separate and still read true, so nothing here offers a feature that
 * would then fail.
 */
/**
 * CSS that hides ad surfaces already on screen.
 *
 * Disabling a manager stops the next ad; it does not tear down one the client
 * has already rendered. Prefer semantic test ids and the locale-independent
 * player state class over hashed client class names and translated labels.
 */
export const AD_SURFACE_CSS = `
	[data-testid="embedded-ad"],
	[data-testid="ad-companion-card"],
	[data-testid="hpto-container"],
	[data-testid="home-ads-container"],
	html.spicetify-adblock-ad-playing .main-nowPlayingView-mainWrapper,
	.main-leaderboardComponent-container {
		display: none !important;
	}
`;

export const UPSELL_CSS = `
	a[href*="/premium"],
	li:has(> a[href*="/premium"]),
	.main-topBar-UpgradeButton,
	[data-testid="upgrade-button"] {
		display: none !important;
	}
`;

/** Installs `css` under `id`, replacing any previous copy. Returns a remover. */
export function injectStyle(id: string, css: string): () => void {
	document.getElementById(id)?.remove();
	const style = document.createElement("style");
	style.id = id;
	style.textContent = css;
	document.head.appendChild(style);
	return () => document.getElementById(id)?.remove();
}
