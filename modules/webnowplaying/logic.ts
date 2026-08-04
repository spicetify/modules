/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The client-free half of WebNowPlaying: wire-format helpers and the
// optimistic state transitions the Rev1 protocol reports to companion
// adapters. These are the module's contract with Rainmeter/OBS displays -
// a wrong repeat cycle or time format shows up on someone's desktop
// widget, so they are pinned by tests. mod.tsx keeps the socket and every
// player call.

export function pad(num: number, size: number): string {
	return num.toString().padStart(size, "0");
}

export function timeInSecondsToString(timeInSeconds: number): string {
	const timeInMinutes = Math.floor(timeInSeconds / 60);
	if (timeInMinutes < 60) return `${timeInMinutes}:${pad(Math.floor(timeInSeconds % 60), 2)}`;

	return `${Math.floor(timeInMinutes / 60)}:${pad(Math.floor(timeInMinutes % 60), 2)}:${pad(Math.floor(timeInSeconds % 60), 2)}`;
}

// The optimistic transitions applied after forwarding an event to the
// player, so the companion sees the expected end state immediately.
export function togglePlayingState(current: string): string {
	return current === "PLAYING" ? "PAUSED" : "PLAYING";
}

export function nextRepeatState(current: string): string {
	return current === "NONE" ? "ALL" : current === "ALL" ? "ONE" : "NONE";
}

// SET_RATING maps the companion's 0-5 scale onto Spotify's binary heart:
// >= 3 likes, < 3 unlikes, and the toggle only fires when the state
// actually changes (currentRating > 3 means currently liked).
export function ratingShouldToggleHeart(rating: number, currentRating: number): boolean {
	const isLiked = currentRating > 3;
	return (rating >= 3 && !isLiked) || (rating < 3 && isLiked);
}

// SET_POSITION data arrives as "seconds:percentage" with a locale-dependent
// decimal comma; the player seeks by the percentage.
export function parsePositionPercentage(data: string): number {
	const [, positionPercentage] = data.split(":");
	return Number.parseFloat(positionPercentage.replace(",", "."));
}
