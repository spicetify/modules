/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @ts-nocheck — extracted verbatim from the untyped lyrics-plus port; see the
// header note in mod.tsx.

// LRCLIB: free synced/unsynced lyrics. getSynced/getUnsynced take the track
// duration explicitly (the karaoke end-time fallback) so this file stays
// client-free outside findLyrics — the caller passes the playing track's
// duration, never the prefetched next track's (plan KTD5a).

import { parseLocalLyrics } from "../utils.ts";

export const ProviderLRCLIB = (() => {
	async function findLyrics(info) {
		const baseURL = "https://lrclib.net/api/get";
		const durr = info.duration / 1000;
		const params = {
			track_name: info.title,
			artist_name: info.artist,
			album_name: info.album,
			duration: durr,
		};

		const finalURL = `${baseURL}?${Object.keys(params)
			.map((key) => `${key}=${encodeURIComponent(params[key])}`)
			.join("&")}`;

		const body = await fetch(finalURL, {
			headers: {
				"x-user-agent": `spicetify v${Spicetify.Config.version} (https://github.com/spicetify/cli)`,
			},
		});

		if (body.status !== 200) {
			return {
				error: "Request error: Track wasn't found",
				uri: info.uri,
			};
		}

		return await body.json();
	}

	function getUnsynced(body, trackDurationMs) {
		const unsyncedLyrics = body?.plainLyrics;
		const isInstrumental = body.instrumental;
		if (isInstrumental) return [{ text: "♪ Instrumental ♪" }];

		if (!unsyncedLyrics) return null;

		return parseLocalLyrics(unsyncedLyrics, trackDurationMs).unsynced;
	}

	function getSynced(body, trackDurationMs) {
		const syncedLyrics = body?.syncedLyrics;
		const isInstrumental = body.instrumental;
		if (isInstrumental) return [{ text: "♪ Instrumental ♪" }];

		if (!syncedLyrics) return null;

		return parseLocalLyrics(syncedLyrics, trackDurationMs).synced;
	}

	return { findLyrics, getSynced, getUnsynced };
})();
