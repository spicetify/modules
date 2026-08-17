/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @ts-nocheck — extracted verbatim from the untyped lyrics-plus port; see the
// header note in mod.tsx.

// The six-entry provider registry: four delegate to the provider files,
// spotify and local are implemented inline. Client-bound policy arrives as
// injected deps — the caller supplies the PLAYING track's duration (KTD5a)
// and the Han-simplification helper (KTD6) — so this file imports clean
// under node --test. Ordering and the service.on filter deliberately live
// with LyricsContainer.tryServices, not here.

import { CONFIG } from "../config.ts";
import { lyricsClient as client } from "../runtime-client.ts";
import { processLyrics } from "../utils.ts";
import { ProviderGenius } from "./genius.ts";
import { ProviderLRCLIB } from "./lrclib.ts";
import { ProviderMusixmatch } from "./musixmatch.ts";
import { ProviderNetease } from "./netease.ts";

export interface ProviderDeps {
	trackDurationMs: () => number;
	simplifyChinese: (s: string) => Promise<string>;
	spicetifyVersion: () => string | undefined;
}

export function createProviders(deps: ProviderDeps) {
	return {
		spotify: async (info) => {
			const result = {
				uri: info.uri,
				karaoke: null,
				synced: null,
				unsynced: null,
				provider: "Spotify",
				copyright: null,
			};

			const baseURL = "https://spclient.wg.spotify.com/color-lyrics/v2/track/";
			const id = info.uri.split(":")[2];
			let body;
			try {
				body = await client.cosmos.get(`${baseURL + id}?format=json&vocalRemoval=false&market=from_token`);
			} catch {
				return { error: "Request error", uri: info.uri };
			}

			const lyrics = body.lyrics;
			if (!lyrics) {
				return { error: "No lyrics", uri: info.uri };
			}

			const lines = lyrics.lines;
			if (lyrics.syncType === "LINE_SYNCED") {
				result.synced = lines.map((line) => ({
					startTime: line.startTimeMs,
					text: line.words,
				}));
				result.unsynced = result.synced;
			} else {
				result.unsynced = lines.map((line) => ({
					text: line.words,
				}));
			}

			/**
			 * to distinguish it from the existing Musixmatch, the provider will remain as Spotify.
			 * if Spotify official lyrics support multiple providers besides Musixmatch in the future, please uncomment the under section. */
			// result.provider = lyrics.provider;

			return result;
		},
		musixmatch: async (info) => {
			const result = {
				error: null,
				uri: info.uri,
				karaoke: null,
				synced: null,
				unsynced: null,
				musixmatchTranslation: null,
				musixmatchAvailableTranslations: [],
				musixmatchTrackId: null,
				musixmatchTranslationLanguage: null,
				provider: "Musixmatch",
				copyright: null,
			};

			let list;
			try {
				list = await ProviderMusixmatch.findLyrics(info);
				if (list.error) {
					throw "";
				}
			} catch {
				result.error = "No lyrics";
				return result;
			}

			const karaoke = await ProviderMusixmatch.getKaraoke(list);
			if (karaoke) {
				result.karaoke = karaoke;
				result.copyright = list["track.lyrics.get"].message?.body?.lyrics?.lyrics_copyright?.trim();
			}
			const synced = ProviderMusixmatch.getSynced(list);
			if (synced) {
				result.synced = synced;
				result.copyright =
					list["track.subtitles.get"].message?.body?.subtitle_list?.[0]?.subtitle.lyrics_copyright.trim();
			}
			const unsynced = synced || ProviderMusixmatch.getUnsynced(list);
			if (unsynced) {
				result.unsynced = unsynced;
				result.copyright = list["track.lyrics.get"].message?.body?.lyrics?.lyrics_copyright?.trim();
			}
			result.musixmatchAvailableTranslations = Array.isArray(list.__musixmatchTranslationStatus)
				? list.__musixmatchTranslationStatus
				: [];
			result.musixmatchTrackId = list.__musixmatchTrackId ?? null;

			const selectedLanguage = CONFIG.visual["musixmatch-translation-language"];
			const canRequestTranslation =
				selectedLanguage &&
				selectedLanguage !== "none" &&
				result.musixmatchAvailableTranslations.includes(selectedLanguage);

			const translation = canRequestTranslation
				? await ProviderMusixmatch.getTranslation(result.musixmatchTrackId)
				: null;
			if ((synced || unsynced) && Array.isArray(translation) && translation.length) {
				const normalizeLyrics =
					typeof processLyrics === "function"
						? (value) => processLyrics(value ?? "")
						: (value) =>
								typeof value === "string"
									? value
											.replace(/　| /g, "")
											.replace(/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~？！，。、《》【】「」]/g, "")
									: "";

				const translationMap = new Map();
				for (const entry of translation) {
					const normalizedMatched = normalizeLyrics(entry.matchedLine);
					if (!translationMap.has(normalizedMatched)) {
						translationMap.set(normalizedMatched, entry.translation);
					}
				}

				const baseLyrics = synced ?? unsynced;
				result.musixmatchTranslation = baseLyrics.map((line) => {
					const originalText = line.text;
					const normalizedOriginal = normalizeLyrics(originalText);
					return {
						...line,
						text: translationMap.get(normalizedOriginal) ?? line.text,
						originalText,
					};
				});
				result.musixmatchTranslationLanguage = selectedLanguage;
			}

			return result;
		},
		netease: async (info) => {
			const result = {
				uri: info.uri,
				karaoke: null,
				synced: null,
				unsynced: null,
				neteaseTranslation: null,
				provider: "Netease",
				copyright: null,
			};

			let list;
			try {
				list = await ProviderNetease.findLyrics(info, deps.simplifyChinese);
			} catch {
				result.error = "No lyrics";
				return result;
			}

			const karaoke = ProviderNetease.getKaraoke(list);
			if (karaoke) {
				result.karaoke = karaoke;
			}
			const synced = ProviderNetease.getSynced(list);
			if (synced) {
				result.synced = synced;
			}
			const unsynced = synced || ProviderNetease.getUnsynced(list);
			if (unsynced) {
				result.unsynced = unsynced;
			}
			const translation = ProviderNetease.getTranslation(list);
			if ((synced || unsynced) && Array.isArray(translation)) {
				const baseLyrics = synced ?? unsynced;
				result.neteaseTranslation = baseLyrics.map((line) => ({
					...line,
					text: translation.find((t) => t.startTime === line.startTime)?.text ?? line.text,
					originalText: line.text,
				}));
			}

			return result;
		},
		lrclib: async (info) => {
			const result = {
				uri: info.uri,
				karaoke: null,
				synced: null,
				unsynced: null,
				provider: "lrclib",
				copyright: null,
			};

			let list;
			try {
				list = await ProviderLRCLIB.findLyrics(info, deps.spicetifyVersion());
			} catch {
				result.error = "No lyrics";
				return result;
			}

			const synced = ProviderLRCLIB.getSynced(list, deps.trackDurationMs());
			if (synced) {
				result.synced = synced;
			}

			const unsynced = synced || ProviderLRCLIB.getUnsynced(list, deps.trackDurationMs());

			if (unsynced) {
				result.unsynced = unsynced;
			}

			return result;
		},
		genius: async (info) => {
			const { lyrics, versions } = await ProviderGenius.fetchLyrics(info);

			let versionIndex2 = 0;
			let genius2 = lyrics;
			if (CONFIG.visual["dual-genius"] && versions.length > 1) {
				genius2 = await ProviderGenius.fetchLyricsVersion(versions, 1);
				versionIndex2 = 1;
			}

			return {
				uri: info.uri,
				genius: lyrics,
				provider: "Genius",
				karaoke: null,
				synced: null,
				unsynced: null,
				copyright: null,
				error: null,
				versions,
				versionIndex: 0,
				genius2,
				versionIndex2,
			};
		},
		local: (info) => {
			let result = {
				uri: info.uri,
				karaoke: null,
				synced: null,
				unsynced: null,
				provider: "local",
			};

			try {
				const savedLyrics = JSON.parse(localStorage.getItem("lyrics-plus:local-lyrics"));
				const lyrics = savedLyrics[info.uri];
				if (!lyrics) {
					throw "";
				}

				result = {
					...result,
					...lyrics,
				};
			} catch {
				result.error = "No lyrics";
			}

			return result;
		},
	};
}
