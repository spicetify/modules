/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The two cross-section callbacks. LyricsContainer assigns them at mount via
// the setters; the settings and menu files read them through a namespace
// import (import * as sharedCallbacks) so the bundler resolves the live
// binding at call time, not a captured undefined at module init.

export let lyricContainerUpdate: (() => void) | undefined;
export let reloadLyrics: (() => void) | undefined;

export function setLyricContainerUpdate(fn: () => void): void {
	lyricContainerUpdate = fn;
}

export function setReloadLyrics(fn: () => void): void {
	reloadLyrics = fn;
}
