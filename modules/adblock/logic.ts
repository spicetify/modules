/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported from veryboringhwl's `adblock` module (MIT). His version drives
 * Spotify's Esperanto ad services, located by scanning webpack exports for a
 * SERVICE_ID. This client exposes the same surfaces directly on
 * `Platform.AdManagers`, so the port targets those instead of reintroducing a
 * scanner.
 */

// Every ad surface the client manages. Each entry either exposes enable() and
// disable() or a plain `enabled` flag, so both shapes are handled.
export const AD_MANAGERS = [
	"audio",
	"inStreamApi",
	"sponsoredPlaylist",
	"hpto",
	"leaderboard",
	"vto",
	"home",
	"survey",
	"embeddedAd",
	"embeddedPlaylist",
] as const;

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
	else if ("enabled" in manager) manager.enabled = false;
	else return false;
	return wasEnabled;
}

export function enableManager(manager: Manager | undefined): void {
	if (!manager) return;
	if (typeof manager.enable === "function") manager.enable();
	else if ("enabled" in manager) manager.enabled = true;
}

type Unsubscribe = () => void;

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
 * `Player.next()` is refused during an ad; the ads connector's own override is
 * the one call that moves past it.
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
