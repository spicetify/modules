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
