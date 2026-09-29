/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Spotify reserves empty slots for native chrome. The Windows container and
// spacer can have unmapped hashes, but the adjacent account controls are mapped.
export const SPACER_CSS = `.spotify__os--is-macos .main-globalNav-historyButtonsWrapper > div:first-child:empty {
	width: 0 !important;
}
.spotify__os--is-windows .main-globalNav-historyButtonsWrapper > div:first-child:empty,
.spotify__os--is-windows .main-globalNav-contentRight > div:last-child:empty,
.spotify__os--is-windows .Root__globalNav > div:has(> .main-topBar-topbarContentRight) > div:last-child:empty {
	display: none !important;
}
.spotify__os--is-windows .main-globalNav-contentRight,
.spotify__os--is-windows .Root__globalNav > div:has(> .main-topBar-topbarContentRight) {
	margin-inline-end: 0 !important;
}`;
