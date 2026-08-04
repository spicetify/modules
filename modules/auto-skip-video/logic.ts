/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The skip decision, client-free so it can be tested. Video media plays as
// media.type "video"; ads are also video, so exclude them (the client
// handles ads, and skipping them here does nothing useful).
export const isSkippableVideo = (item: any): boolean => {
	const meta = item?.metadata ?? {};
	return meta["media.type"] === "video" && meta.is_advertisement !== "true";
};
