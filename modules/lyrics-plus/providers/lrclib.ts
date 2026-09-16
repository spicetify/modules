/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// LRCLIB: free synced/unsynced lyrics. getSynced/getUnsynced take the track
// duration explicitly (the karaoke end-time fallback) so this file stays
// client-free outside findLyrics — the caller passes the playing track's
// duration, never the prefetched next track's (plan KTD5a).

import type { LyricLine, TimedLyricLine, TrackInfo } from "../types.ts";

import { parseLocalLyrics } from "../utils.ts";

interface LRCLIBLyrics {
	instrumental?: boolean;
	plainLyrics?: string;
	syncedLyrics?: string;
	error?: string;
	uri?: string;
}

function parseLyrics(value: unknown): LRCLIBLyrics {
	if (!value || typeof value !== "object") return {};
	return {
		instrumental: "instrumental" in value && value.instrumental === true,
		plainLyrics: "plainLyrics" in value && typeof value.plainLyrics === "string" ? value.plainLyrics : undefined,
		syncedLyrics:
			"syncedLyrics" in value && typeof value.syncedLyrics === "string" ? value.syncedLyrics : undefined,
	};
}

export const ProviderLRCLIB = (() => {
	async function findLyrics(info: TrackInfo, spicetifyVersion?: string): Promise<LRCLIBLyrics> {
		const baseURL = "https://lrclib.net/api/get";
		const durr = info.duration / 1000;
		const params = {
			track_name: info.title,
			artist_name: info.artist,
			album_name: info.album,
			duration: durr,
		};

		const finalURL = `${baseURL}?${Object.entries(params)
			.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
			.join("&")}`;

		const body = await fetch(finalURL, {
			headers: {
				"x-user-agent": `spicetify${spicetifyVersion ? ` v${spicetifyVersion}` : ""} (https://github.com/spicetify/cli)`,
			},
		});

		if (body.status !== 200) {
			return {
				error: "Request error: Track wasn't found",
				uri: info.uri,
			};
		}

		return parseLyrics(await body.json());
	}

	function getUnsynced(body: LRCLIBLyrics, trackDurationMs: number): LyricLine[] | null {
		const unsyncedLyrics = body?.plainLyrics;
		const isInstrumental = body.instrumental;
		if (isInstrumental) return [{ text: "♪ Instrumental ♪" }];

		if (!unsyncedLyrics) return null;

		return parseLocalLyrics(unsyncedLyrics, trackDurationMs).unsynced;
	}

	function getSynced(body: LRCLIBLyrics, trackDurationMs: number): TimedLyricLine[] | null {
		const syncedLyrics = body?.syncedLyrics;
		const isInstrumental = body.instrumental;
		if (isInstrumental) return [{ text: "♪ Instrumental ♪", startTime: 0 }];

		if (!syncedLyrics) return null;

		return parseLocalLyrics(syncedLyrics, trackDurationMs).synced;
	}

	return { findLyrics, getSynced, getUnsynced };
})();
