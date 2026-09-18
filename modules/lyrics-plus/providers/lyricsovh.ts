/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ProviderResult, TrackInfo } from "../types.ts";
import { requestLyrics } from "../runtime-client.ts";
import { removeExtraInfo } from "../utils.ts";

export async function lyricsOvh(info: TrackInfo, signal?: AbortSignal): Promise<ProviderResult> {
	const result: ProviderResult = {
		uri: info.uri,
		provider: "Lyrics.ovh",
		karaoke: null,
		synced: null,
		unsynced: null,
		copyright: null,
	};
	try {
		const body: unknown = await requestLyrics(async (requestSignal) => {
			const base = `https://api.lyrics.ovh/v1/${encodeURIComponent(info.artist)}/`;
			let response = await fetch(`${base}${encodeURIComponent(info.title)}`, { signal: requestSignal });
			const title = removeExtraInfo(info.title).trim();
			if (response.status === 404 && title && title !== info.title) {
				requestSignal.throwIfAborted();
				response = await fetch(`${base}${encodeURIComponent(title)}`, { signal: requestSignal });
			}
			return response.ok ? response.json() : null;
		}, signal);
		if (
			body &&
			typeof body === "object" &&
			"lyrics" in body &&
			typeof body.lyrics === "string" &&
			body.lyrics.trim()
		) {
			result.unsynced = body.lyrics
				.trim()
				.split(/\r?\n/)
				.map((text) => ({ text }));
			return result;
		}
	} catch {
		// A missing or unavailable provider must leave the other sources usable.
	}
	return { ...result, error: "No lyrics" };
}
