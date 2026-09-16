/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The six-entry provider registry: four delegate to the provider files,
// spotify and local are implemented inline. Client-bound policy arrives as
// injected deps — the caller supplies the PLAYING track's duration (KTD5a)
// and the Han-simplification helper (KTD6) — so this file imports clean
// under node --test. Ordering and the service.on filter deliberately live
// with LyricsContainer.tryServices, not here.

import { CONFIG } from "../config.ts";
import type { GeniusVersion, KaraokeLine, LyricLine, ProviderResult, TimedLyricLine, TrackInfo } from "../types.ts";
import { getLyricsResponse } from "../runtime-client.ts";
import { processLyrics } from "../utils.ts";
import { ProviderGenius } from "./genius.ts";
import { ProviderLRCLIB } from "./lrclib.ts";
import { ProviderMusixmatch } from "./musixmatch.ts";
import { ProviderNetease } from "./netease.ts";

interface SpotifyLyrics {
	syncType: string;
	lines: { startTimeMs: number; words: string }[];
}
function parseSpotifyLyrics(value: unknown): SpotifyLyrics | null {
	if (!value || typeof value !== "object" || !("lyrics" in value)) return null;
	const lyrics = value.lyrics;
	if (
		!lyrics ||
		typeof lyrics !== "object" ||
		!("syncType" in lyrics) ||
		typeof lyrics.syncType !== "string" ||
		!("lines" in lyrics) ||
		!Array.isArray(lyrics.lines)
	)
		return null;
	const lines = lyrics.lines.flatMap((line: unknown) => {
		if (!line || typeof line !== "object" || !("words" in line) || typeof line.words !== "string") return [];
		const rawTime = "startTimeMs" in line ? line.startTimeMs : undefined;
		const startTimeMs = typeof rawTime === "number" || typeof rawTime === "string" ? Number(rawTime) : 0;
		return Number.isFinite(startTimeMs) ? [{ words: line.words, startTimeMs }] : [];
	});
	return { syncType: lyrics.syncType, lines };
}
function isLine(value: unknown): value is LyricLine {
	return (
		!!value &&
		typeof value === "object" &&
		"text" in value &&
		typeof value.text === "string" &&
		(!("startTime" in value) || typeof value.startTime === "number") &&
		(!("endTime" in value) || typeof value.endTime === "number") &&
		(!("originalText" in value) || typeof value.originalText === "string") &&
		(!("performer" in value) || value.performer === null || typeof value.performer === "string")
	);
}
function isTimedLine(value: unknown): value is TimedLyricLine {
	return isLine(value) && typeof value.startTime === "number";
}
function isWords(value: unknown): value is KaraokeLine["text"] {
	return (
		Array.isArray(value) &&
		value.every(
			(word: unknown) =>
				!!word &&
				typeof word === "object" &&
				"word" in word &&
				typeof word.word === "string" &&
				"time" in word &&
				typeof word.time === "number",
		)
	);
}
function isKaraokeLine(value: unknown): value is KaraokeLine {
	return (
		!!value &&
		typeof value === "object" &&
		"startTime" in value &&
		typeof value.startTime === "number" &&
		"text" in value &&
		isWords(value.text) &&
		(!("originalText" in value) || typeof value.originalText === "string" || isWords(value.originalText)) &&
		(!("endTime" in value) || typeof value.endTime === "number") &&
		(!("performer" in value) || value.performer === null || typeof value.performer === "string")
	);
}

function isVersion(value: unknown): value is GeniusVersion {
	return (
		!!value &&
		typeof value === "object" &&
		"title" in value &&
		typeof value.title === "string" &&
		"url" in value &&
		typeof value.url === "string"
	);
}

export function parseCachedLyrics(value: unknown): Omit<ProviderResult, "uri"> | null {
	if (!value || typeof value !== "object") return null;
	const karaoke =
		"karaoke" in value && Array.isArray(value.karaoke) && value.karaoke.every(isKaraokeLine) ? value.karaoke : null;
	const synced =
		"synced" in value && Array.isArray(value.synced) && value.synced.every(isTimedLine) ? value.synced : null;
	const unsynced =
		"unsynced" in value && Array.isArray(value.unsynced) && value.unsynced.every(isLine) ? value.unsynced : null;
	if (!karaoke && !synced && !unsynced) return null;
	return {
		karaoke,
		synced,
		unsynced,
		provider: "provider" in value && typeof value.provider === "string" ? value.provider : undefined,
		copyright: "copyright" in value && typeof value.copyright === "string" ? value.copyright : undefined,
		genius: "genius" in value && typeof value.genius === "string" ? value.genius : null,
		genius2: "genius2" in value && typeof value.genius2 === "string" ? value.genius2 : null,
		musixmatchTranslation:
			"musixmatchTranslation" in value &&
			Array.isArray(value.musixmatchTranslation) &&
			value.musixmatchTranslation.every(isLine)
				? value.musixmatchTranslation
				: null,
		neteaseTranslation:
			"neteaseTranslation" in value &&
			Array.isArray(value.neteaseTranslation) &&
			value.neteaseTranslation.every(isLine)
				? value.neteaseTranslation
				: null,
		musixmatchAvailableTranslations:
			"musixmatchAvailableTranslations" in value &&
			Array.isArray(value.musixmatchAvailableTranslations) &&
			value.musixmatchAvailableTranslations.every(
				(language: unknown): language is string => typeof language === "string",
			)
				? value.musixmatchAvailableTranslations
				: [],
		musixmatchTrackId:
			"musixmatchTrackId" in value && typeof value.musixmatchTrackId === "number"
				? value.musixmatchTrackId
				: null,
		musixmatchTranslationLanguage:
			"musixmatchTranslationLanguage" in value && typeof value.musixmatchTranslationLanguage === "string"
				? value.musixmatchTranslationLanguage
				: null,
		versions:
			"versions" in value && Array.isArray(value.versions) && value.versions.every(isVersion)
				? value.versions
				: undefined,
		versionIndex:
			"versionIndex" in value && typeof value.versionIndex === "number" ? value.versionIndex : undefined,
		versionIndex2:
			"versionIndex2" in value && typeof value.versionIndex2 === "number" ? value.versionIndex2 : undefined,
		mode: "mode" in value && typeof value.mode === "number" ? value.mode : undefined,
	};
}

export interface ProviderDeps {
	trackDurationMs: () => number;
	simplifyChinese: (s: string) => Promise<string>;
	spicetifyVersion: () => string | undefined;
}

export function createProviders(deps: ProviderDeps) {
	return {
		spotify: async (info: Pick<TrackInfo, "uri">, signal?: AbortSignal): Promise<ProviderResult> => {
			const result: ProviderResult = {
				uri: info.uri,
				karaoke: null,
				synced: null,
				unsynced: null,
				provider: "Spotify",
				copyright: null,
			};

			const baseURL = "https://spclient.wg.spotify.com/color-lyrics/v2/track/";
			const id = info.uri.split(":")[2];
			let body: unknown;
			try {
				body = await getLyricsResponse(
					`${baseURL + id}?format=json&vocalRemoval=false&market=from_token`,
					signal,
				);
			} catch {
				return { error: "Request error", uri: info.uri };
			}

			const lyrics = parseSpotifyLyrics(body);
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
		musixmatch: async (info: TrackInfo, signal?: AbortSignal): Promise<ProviderResult> => {
			const result: ProviderResult = {
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
				list = await ProviderMusixmatch.findLyrics(info, signal);
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
				result.copyright = list["track.lyrics.get"]?.message?.body?.lyrics?.lyrics_copyright?.trim();
			}
			const synced = ProviderMusixmatch.getSynced(list);
			if (synced) {
				result.synced = synced;
				result.copyright =
					list["track.subtitles.get"]?.message?.body?.subtitle_list?.[0]?.subtitle.lyrics_copyright?.trim();
			}
			const unsynced = synced || ProviderMusixmatch.getUnsynced(list);
			if (unsynced) {
				result.unsynced = unsynced;
				result.copyright = list["track.lyrics.get"]?.message?.body?.lyrics?.lyrics_copyright?.trim();
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
				? await ProviderMusixmatch.getTranslation(result.musixmatchTrackId, signal)
				: null;
			const baseLyrics = synced ?? unsynced;
			if (baseLyrics && Array.isArray(translation) && translation.length) {
				const translationMap = new Map<string, string>();
				for (const entry of translation) {
					const normalizedMatched = processLyrics(entry.matchedLine);
					if (!translationMap.has(normalizedMatched)) {
						translationMap.set(normalizedMatched, entry.translation);
					}
				}

				result.musixmatchTranslation = baseLyrics.map((line) => {
					const originalText = line.text;
					const normalizedOriginal = processLyrics(originalText);
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
		netease: async (info: TrackInfo, signal?: AbortSignal): Promise<ProviderResult> => {
			const result: ProviderResult = {
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
				list = await ProviderNetease.findLyrics(info, deps.simplifyChinese, signal);
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
			const baseLyrics = synced ?? unsynced;
			if (baseLyrics && Array.isArray(translation)) {
				result.neteaseTranslation = baseLyrics.map((line) => ({
					...line,
					text: translation.find((t) => t.startTime === line.startTime)?.text ?? line.text,
					originalText: line.text,
				}));
			}

			return result;
		},
		lrclib: async (info: TrackInfo, signal?: AbortSignal): Promise<ProviderResult> => {
			const result: ProviderResult = {
				uri: info.uri,
				karaoke: null,
				synced: null,
				unsynced: null,
				provider: "lrclib",
				copyright: null,
			};

			let list;
			try {
				list = await ProviderLRCLIB.findLyrics(info, deps.spicetifyVersion(), signal);
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
		genius: async (info: TrackInfo, signal?: AbortSignal): Promise<ProviderResult> => {
			const { lyrics, versions } = await ProviderGenius.fetchLyrics(info, signal);

			let versionIndex2 = 0;
			let genius2 = lyrics;
			if (CONFIG.visual["dual-genius"] && versions.length > 1) {
				genius2 = await ProviderGenius.fetchLyricsVersion(versions, 1, signal);
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
		local: (info: Pick<TrackInfo, "uri">): ProviderResult => {
			let result: ProviderResult = {
				uri: info.uri,
				karaoke: null,
				synced: null,
				unsynced: null,
				provider: "local",
			};

			try {
				const savedLyrics: unknown = JSON.parse(localStorage.getItem("lyrics-plus:local-lyrics") ?? "null");
				const entry =
					savedLyrics && typeof savedLyrics === "object"
						? Object.entries(savedLyrics).find(([uri]) => uri === info.uri)?.[1]
						: undefined;
				const lyrics = parseCachedLyrics(entry);
				if (!lyrics) {
					throw "";
				}

				result = {
					...result,
					...lyrics,
					provider: lyrics.provider ?? result.provider,
				};
			} catch {
				result.error = "No lyrics";
			}

			return result;
		},
	};
}
