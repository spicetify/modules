/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The pure core of full-app-display: config parsing, the pointer-to-progress
// math shared by the bar's click and drag handlers, and the overlay root class
// string, hoisted from the module closure so they run under node --test.

export function parseConfig(raw: string | null): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(raw || "{}");
		if (parsed && typeof parsed === "object") {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

export function progressFromPointer(clientX: number, rectLeft: number, rectWidth: number, duration: number): number {
	return ((clientX - rectLeft) / rectWidth) * duration;
}

export function thumbPercent(progress: number, duration: number): number {
	return (progress / duration) * 100;
}

export function rootClasses(
	config: { vertical?: boolean; lyricsPlus?: boolean },
	lyricsPlusAvailable: boolean,
): string {
	return `Video VideoPlayer--fullscreen VideoPlayer--landscape${config.vertical ? " fad-vertical" : ""}${
		lyricsPlusAvailable && config.lyricsPlus ? " fad-lyrics-plus" : ""
	}`;
}
