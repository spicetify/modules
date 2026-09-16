/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Musixmatch: karaoke, synced, unsynced, and translations, behind the app
// usertoken. The React hook over the token state stays in mod.tsx; this file
// owns the state and must stay importable under node --test, so the client
// is only touched inside the network calls.

import { responseRecord as record } from "../cosmos-responses.ts";
import { CONFIG } from "../config.ts";
import { getLyricsResponse, requestLyrics } from "../runtime-client.ts";
import type { KaraokeLine, LyricLine, TimedLyricLine, TrackInfo } from "../types.ts";

interface Performer {
	fqid?: string;
	artist_id: number | null;
	name: string;
}
interface PerformerSnippet {
	text: string;
	raw: string;
	performers: Performer[];
}
interface PerformerTag {
	snippet?: string;
	performers: { type: string; fqid?: string }[];
}
interface TrackMetadata {
	track?: {
		track_id?: number;
		has_richsync?: boolean;
		has_subtitles?: boolean;
		has_lyrics?: boolean;
		has_lyrics_crowd?: boolean;
		instrumental?: boolean;
		performer_tagging?: {
			content: PerformerTag[];
			resources: { artists: { artist_id: number; artist_name: string }[] };
		};
		performer_tagging_misc_tags?: Record<string, string>;
	};
}
interface ApiCall<Body> {
	message?: { header?: { status_code?: number; mode?: string }; body?: Body };
}
interface MusixmatchLyrics {
	"matcher.track.get"?: ApiCall<TrackMetadata>;
	"track.lyrics.get"?: ApiCall<{
		lyrics?: { restricted?: boolean; lyrics_body?: string; lyrics_copyright?: string };
	}>;
	"track.subtitles.get"?: ApiCall<{
		subtitle_list?: { subtitle: { subtitle_body: string; lyrics_copyright?: string } }[];
	}>;
	"track.richsync.get"?: ApiCall<{ richsync?: { richsync_body: string } }>;
	__musixmatchTranslationStatus?: string[];
	__musixmatchTrackId?: number | null;
	error?: string;
	uri?: string;
}
interface MusixmatchBody {
	user_token?: string;
	macro_calls?: MusixmatchLyrics;
	translations_list?: { translation: { description: string; matched_line: string } }[];
	language_list?: {
		language: { language_name: string; language_iso_code_1?: string; language_iso_code_3?: string };
	}[];
}
interface RichsyncLine {
	ts: number;
	te: number;
	l: { c: string; o: number }[];
}
interface SubtitleLine {
	text: string;
	time: { total: number };
}

function string(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
function parseCall<T>(value: unknown, parseBody: (value: unknown) => T): ApiCall<T> | undefined {
	const source = record(value);
	if (!source.message) return undefined;
	const message = record(source.message);
	const header = record(message.header);
	return {
		message: {
			header: { status_code: number(header.status_code), mode: string(header.mode) },
			body: message.body ? parseBody(message.body) : undefined,
		},
	};
}
function parseTrack(value: unknown): TrackMetadata {
	const source = record(value);
	if (!source.track) return {};
	const track = record(source.track);
	const tagging = record(track.performer_tagging);
	const artists = record(tagging.resources).artists;
	const resources = Array.isArray(artists) ? artists : Object.values(record(artists));
	return {
		track: {
			track_id: number(track.track_id),
			has_richsync: track.has_richsync === true || track.has_richsync === 1,
			has_subtitles: track.has_subtitles === true || track.has_subtitles === 1,
			has_lyrics: track.has_lyrics === true || track.has_lyrics === 1,
			has_lyrics_crowd: track.has_lyrics_crowd === true || track.has_lyrics_crowd === 1,
			instrumental: track.instrumental === true || track.instrumental === 1,
			performer_tagging: {
				content: array(tagging.content).map((item) => {
					const tag = record(item);
					return {
						snippet: string(tag.snippet),
						performers: array(tag.performers).flatMap((item) => {
							const performer = record(item);
							const type = string(performer.type);
							return type ? [{ type, fqid: string(performer.fqid) }] : [];
						}),
					};
				}),
				resources: {
					artists: resources.flatMap((item) => {
						const artist = record(item);
						const artist_id = number(artist.artist_id);
						const artist_name = string(artist.artist_name);
						return artist_id !== undefined && artist_name !== undefined ? [{ artist_id, artist_name }] : [];
					}),
				},
			},
			performer_tagging_misc_tags: Object.fromEntries(
				Object.entries(record(track.performer_tagging_misc_tags)).flatMap(([key, value]) =>
					typeof value === "string" ? [[key, value]] : [],
				),
			),
		},
	};
}
function findTranslationStatus(value: unknown): string[] | null {
	if (!value || typeof value !== "object") return null;
	const source = record(value);
	if (Array.isArray(source.track_lyrics_translation_status)) {
		return source.track_lyrics_translation_status.flatMap((item) => {
			const to = record(item).to;
			return typeof to === "string" && to ? [to] : [];
		});
	}
	for (const child of Object.values(value)) {
		const result = findTranslationStatus(child);
		if (result) return result;
	}
	return null;
}
function parseMacroCalls(value: unknown): MusixmatchLyrics {
	const calls = record(value);
	return {
		"matcher.track.get": parseCall(calls["matcher.track.get"], parseTrack),
		"track.lyrics.get": parseCall(calls["track.lyrics.get"], (value) => {
			const lyrics = record(record(value).lyrics);
			return {
				lyrics: {
					restricted: lyrics.restricted === true || lyrics.restricted === 1,
					lyrics_body: string(lyrics.lyrics_body),
					lyrics_copyright: string(lyrics.lyrics_copyright),
				},
			};
		}),
		"track.subtitles.get": parseCall(calls["track.subtitles.get"], (value) => ({
			subtitle_list: array(record(value).subtitle_list).flatMap((item) => {
				const subtitle = record(record(item).subtitle);
				const subtitle_body = string(subtitle.subtitle_body);
				return subtitle_body !== undefined
					? [{ subtitle: { subtitle_body, lyrics_copyright: string(subtitle.lyrics_copyright) } }]
					: [];
			}),
		})),
		"track.richsync.get": parseCall(calls["track.richsync.get"], (value) => {
			const richsync_body = string(record(record(value).richsync).richsync_body);
			return { richsync: richsync_body !== undefined ? { richsync_body } : undefined };
		}),
		__musixmatchTranslationStatus: [...new Set(findTranslationStatus(value) ?? [])],
	};
}
function parseResponse(value: unknown): ApiCall<MusixmatchBody> {
	return (
		parseCall(value, (value) => {
			const body = record(value);
			return {
				user_token: string(body.user_token),
				macro_calls: body.macro_calls ? parseMacroCalls(body.macro_calls) : undefined,
				translations_list: array(body.translations_list).flatMap((item) => {
					const translation = record(record(item).translation);
					const description = string(translation.description);
					const matched_line = string(translation.matched_line);
					return description !== undefined && matched_line !== undefined
						? [{ translation: { description, matched_line } }]
						: [];
				}),
				language_list: Array.isArray(body.language_list)
					? body.language_list.flatMap((item: unknown) => {
							const language = record(record(item).language);
							const language_name = string(language.language_name);
							return language_name
								? [
										{
											language: {
												language_name,
												language_iso_code_1: string(language.language_iso_code_1),
												language_iso_code_3: string(language.language_iso_code_3),
											},
										},
									]
								: [];
						})
					: undefined,
			};
		}) ?? {}
	);
}
function isRichsyncLine(value: unknown): value is RichsyncLine {
	const line = record(value);
	return (
		number(line.ts) !== undefined &&
		number(line.te) !== undefined &&
		Array.isArray(line.l) &&
		line.l.every((value: unknown) => {
			const word = record(value);
			return typeof word.c === "string" && number(word.o) !== undefined;
		})
	);
}
function parseSubtitles(value: unknown): SubtitleLine[] {
	return array(value).flatMap((value) => {
		const line = record(value);
		const text = string(line.text);
		const total = number(record(line.time).total);
		return text !== undefined && total !== undefined ? [{ text, time: { total } }] : [];
	});
}

// Whether the current Musixmatch usertoken authenticates. The provider UI reads
// this to disable itself and explain why when an automatic refresh can't recover.
let musixmatchTokenValid = true;
export const musixmatchTokenListeners = new Set<(valid: boolean) => void>();
export function setMusixmatchTokenValid(valid: boolean) {
	if (musixmatchTokenValid === valid) return;
	musixmatchTokenValid = valid;
	for (const listener of musixmatchTokenListeners) listener(valid);
}

export function isMusixmatchTokenValid() {
	return musixmatchTokenValid;
}

export const ProviderMusixmatch = (() => {
	const headers = {
		Host: "apic-appmobile.musixmatch.com",
		authority: "apic-appmobile.musixmatch.com",
		"X-Cookie": "x-mxm-token-guid=",
		"x-mxm-app-version": "10.1.1",
		"X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
		"Accept-Language": "en-US,en;q=0.9",
		Connection: "keep-alive",
		Accept: "application/json",
	};

	// The shared Musixmatch usertoken expires. When a call comes back 401 we mint
	// a fresh mac-ios token once and retry, so lyrics and translation keep working
	// without the user having to find the Refresh token button.
	function buildRequestUrl(baseURL: string, params: Record<string, string | number>) {
		return (token: string) =>
			baseURL +
			Object.entries({ ...params, usertoken: token })
				.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
				.join("&");
	}

	let pendingTokenRefresh: Promise<string | null> | null = null;
	function refreshToken() {
		if (!pendingTokenRefresh) {
			pendingTokenRefresh = (async () => {
				try {
					const { message } = parseResponse(
						await getLyricsResponse(
							"https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0",
							undefined,
							undefined,
							headers,
						),
					);
					const token = message?.body?.user_token;
					if (message?.header?.status_code === 200 && token && !token.startsWith("UpgradeOnly")) {
						CONFIG.providers.musixmatch.token = token;
						localStorage.setItem("lyrics-plus:provider:musixmatch:token", token);
						setMusixmatchTokenValid(true);
						return token;
					}
				} catch (error) {
					if (error instanceof DOMException && error.name === "AbortError") throw error;
					console.error("Musixmatch token refresh failed", error);
				}
				setMusixmatchTokenValid(false);
				return null;
			})().finally(() => {
				pendingTokenRefresh = null;
			});
		}
		return pendingTokenRefresh;
	}

	async function request(
		buildURL: (token: string) => string,
		signal?: AbortSignal,
	): Promise<ApiCall<MusixmatchBody>> {
		let body = parseResponse(
			await getLyricsResponse(buildURL(CONFIG.providers.musixmatch.token), signal, undefined, headers),
		);
		if (body?.message?.header?.status_code === 401) {
			const token = await requestLyrics(() => refreshToken(), signal);
			if (token) body = parseResponse(await getLyricsResponse(buildURL(token), signal, undefined, headers));
		} else if (body?.message?.header?.status_code === 200) {
			setMusixmatchTokenValid(true);
		}
		return body;
	}

	async function findLyrics(info: TrackInfo, signal?: AbortSignal): Promise<MusixmatchLyrics> {
		const baseURL =
			"https://apic-appmobile.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&namespace=lyrics_richsynched&subtitle_format=mxm&app_id=mac-ios-v2.0&";

		const durr = info.duration / 1000;

		const params = {
			q_album: info.album,
			q_artist: info.artist,
			q_artists: info.artist,
			q_track: info.title,
			track_spotify_id: info.uri,
			q_duration: durr,
			f_subtitle_length: Math.floor(durr),
			optional_calls: "track.richsync",
			richsync_compact_type: "words",
			part: "track_lyrics_translation_status,track_structure,track_performer_tagging",
		};

		const response = await request(buildRequestUrl(baseURL, params), signal);
		const body = response.message?.body?.macro_calls;

		if (!body || body["matcher.track.get"]?.message?.header?.status_code !== 200) {
			return {
				error: `Requested error: ${body?.["matcher.track.get"]?.message?.header?.mode ?? "unauthorized"}`,
				uri: info.uri,
			};
		}
		if (body["track.lyrics.get"]?.message?.body?.lyrics?.restricted) {
			return {
				error: "Unfortunately we're not authorized to show these lyrics.",
				uri: info.uri,
			};
		}

		const translationStatus = body.__musixmatchTranslationStatus;
		const meta = body?.["matcher.track.get"]?.message?.body;
		const availableTranslations = Array.isArray(translationStatus) ? [...new Set(translationStatus)] : [];

		Object.defineProperties(body, {
			__musixmatchTranslationStatus: {
				value: availableTranslations,
			},
			__musixmatchTrackId: {
				value: meta?.track?.track_id ?? null,
			},
		});

		return body;
	}

	function parsePerformerData(meta: TrackMetadata | undefined): PerformerSnippet[] {
		if (!meta || !meta.track || !meta.track.performer_tagging) {
			return [];
		}

		const tagging = meta.track.performer_tagging;
		const miscTags = meta.track.performer_tagging_misc_tags || {};
		let performerMap: { name: string; snippet?: string; performers: Performer[] }[] = [];
		if (tagging && tagging.content && tagging.content.length > 0) {
			const resourcesList = tagging.resources.artists;

			performerMap = tagging.content
				.map((c) => {
					if (!c.performers || c.performers.length === 0) return null;

					const resolvedPerformers = c.performers
						.map((p) => {
							let name = "Unknown";
							if (p.type === "artist") {
								const fqid = p.fqid;
								const idFromFqid = fqid ? parseInt(fqid.split(":")[2]) : null;

								const artist = resourcesList.find((r) => r.artist_id === idFromFqid);
								if (artist) name = artist.artist_name;
							} else if (miscTags[p.type]) {
								name = miscTags[p.type];
							}
							return {
								fqid: p.fqid,
								artist_id: p.fqid ? parseInt(p.fqid.split(":")[2]) : null,
								name: name,
							};
						})
						.filter((p) => p.name !== "Unknown");

					const names = resolvedPerformers.map((p) => p.name);
					if (names.length === 0) return null;

					return {
						name: names.join(", "),
						snippet: c.snippet,
						performers: resolvedPerformers,
					};
				})
				.filter((tag) => tag !== null);
		}

		const normalizeForMatch = (text: string) => text.replace(/\s+/g, "").toLowerCase();

		const snippetQueue: PerformerSnippet[] = [];
		if (performerMap.length > 0) {
			for (const tag of performerMap) {
				if (!tag.snippet) continue;
				const snippetLines = tag.snippet
					.split(/\n+/)
					.map((s) => s.trim())
					.filter(Boolean);
				for (const sLine of snippetLines) {
					if (sLine.length < 2 && !/^[\u3131-\uD79D]/.test(sLine)) continue;
					snippetQueue.push({
						text: normalizeForMatch(sLine),
						raw: sLine,
						performers: tag.performers,
					});
				}
			}
		}
		return snippetQueue;
	}

	function matchSequential<Line>(
		lyricsLines: Line[],
		snippetQueue: PerformerSnippet[],
		getTextCallback: (line: Line) => string,
	): (Line & { performers?: Performer[] })[] {
		const normalizeForMatch = (text: string) => text.replace(/\s+/g, "").toLowerCase();
		let queueCursor = 0;
		const LOOKAHEAD = 5;

		return lyricsLines.map((line) => {
			const lineText = getTextCallback(line) || "♪";
			let normalizedLine = normalizeForMatch(lineText);

			const matchedPerformers: Performer[] = [];

			while (queueCursor < snippetQueue.length) {
				let matchFoundAtOffset = -1;

				for (let i = 0; i < LOOKAHEAD && queueCursor + i < snippetQueue.length; i++) {
					const snippet = snippetQueue[queueCursor + i];

					if (normalizedLine.includes(snippet.text) && snippet.text.length > 0) {
						matchFoundAtOffset = i;
						break;
					}
				}

				if (matchFoundAtOffset !== -1) {
					queueCursor += matchFoundAtOffset;
					const matchedSnippet = snippetQueue[queueCursor];
					matchedPerformers.push(...matchedSnippet.performers);
					normalizedLine = normalizedLine.replace(matchedSnippet.text, "");
					queueCursor++;
				} else {
					break;
				}
			}

			const uniquePerformers: Performer[] = [];
			const sawMap = new Set();
			for (const p of matchedPerformers) {
				const key = p.fqid || p.name;
				if (!sawMap.has(key)) {
					sawMap.add(key);
					uniquePerformers.push(p);
				}
			}

			return {
				...line,
				...(snippetQueue.length ? { performers: uniquePerformers } : {}),
			};
		});
	}

	async function getKaraoke(body: MusixmatchLyrics): Promise<KaraokeLine[] | null> {
		const meta = body?.["matcher.track.get"]?.message?.body;
		if (!meta?.track) {
			return null;
		}

		if (!meta.track.has_richsync || meta.track.instrumental) {
			return null;
		}

		const richsyncCall = body?.["track.richsync.get"];
		if (richsyncCall?.message?.header?.status_code !== 200 || !richsyncCall?.message?.body?.richsync) {
			return null;
		}

		const result = richsyncCall.message.body.richsync;
		let rawKaraoke: unknown;
		try {
			rawKaraoke = JSON.parse(result.richsync_body);
		} catch {
			return null;
		}

		if (!Array.isArray(rawKaraoke) || !rawKaraoke.every(isRichsyncLine)) {
			return null;
		}

		const snippetQueue = parsePerformerData(meta);

		const parsedKaraoke = rawKaraoke.map((line) => {
			const startTime = line.ts * 1000;
			const endTime = line.te * 1000;
			const words = line.l;

			const text = words.map((word, index, words) => {
				const wordText = word.c;
				const wordStartTime = word.o * 1000;
				const nextWordStartTime = words[index + 1]?.o * 1000;

				const time = !Number.isNaN(nextWordStartTime)
					? nextWordStartTime - wordStartTime
					: endTime - (wordStartTime + startTime);

				return {
					word: wordText,
					time,
				};
			});
			return {
				startTime,
				endTime,
				text,
			};
		});

		return matchSequential(parsedKaraoke, snippetQueue, (line) => {
			if (Array.isArray(line.text)) {
				return line.text.map((t) => t.word).join("");
			}
			return line.text;
		}).map((line) => {
			const performerNames = (line.performers || [])
				.map((p) => p.name)
				.filter(Boolean)
				.join(", ");
			return {
				...line,
				performer: performerNames || null,
			};
		});
	}

	function getSynced(body: MusixmatchLyrics): TimedLyricLine[] | null {
		const meta = body?.["matcher.track.get"]?.message?.body;
		if (!meta?.track) {
			return null;
		}

		const hasSynced = meta?.track?.has_subtitles;

		const isInstrumental = meta?.track?.instrumental;

		if (isInstrumental) {
			return [{ text: "♪ Instrumental ♪", startTime: 0 }];
		}
		if (hasSynced) {
			const subtitle = body["track.subtitles.get"]?.message?.body?.subtitle_list?.[0]?.subtitle;
			if (!subtitle) {
				return null;
			}

			const snippetQueue = parsePerformerData(meta);
			const rawLines = parseSubtitles(JSON.parse(subtitle.subtitle_body));

			return matchSequential(rawLines, snippetQueue, (l) => l.text).map((line) => {
				const lineText = line.text || "♪";
				const performerNames = (line.performers || [])
					.map((p) => p.name)
					.filter(Boolean)
					.join(", ");

				return {
					text: lineText,
					startTime: line.time.total * 1000,
					performer: performerNames || null,
				};
			});
		}

		return null;
	}

	function getUnsynced(body: MusixmatchLyrics): LyricLine[] | null {
		const meta = body?.["matcher.track.get"]?.message?.body;
		if (!meta?.track) {
			return null;
		}

		const hasUnSynced = meta.track.has_lyrics || meta.track.has_lyrics_crowd;

		const isInstrumental = meta?.track?.instrumental;

		if (isInstrumental) {
			return [{ text: "♪ Instrumental ♪" }];
		}
		if (hasUnSynced) {
			const lyrics = body["track.lyrics.get"]?.message?.body?.lyrics?.lyrics_body;
			if (!lyrics) {
				return null;
			}

			const snippetQueue = parsePerformerData(meta);
			const rawLines = lyrics.split("\n").map((text) => ({ text }));

			return matchSequential(rawLines, snippetQueue, (l) => l.text).map((line) => {
				const performerNames = (line.performers || [])
					.map((p) => p.name)
					.filter(Boolean)
					.join(", ");

				return {
					...line,
					performer: performerNames || null,
				};
			});
		}

		return null;
	}

	async function getTranslation(
		trackId: number | null | undefined,
		signal?: AbortSignal,
	): Promise<{ translation: string; matchedLine: string }[] | null> {
		if (!trackId) return null;

		const selectedLanguage = CONFIG.visual["musixmatch-translation-language"] || "none";
		if (selectedLanguage === "none") return null;

		const baseURL =
			"https://apic-appmobile.musixmatch.com/ws/1.1/crowd.track.translations.get?translation_fields_set=minimal&comment_format=text&format=json&app_id=mac-ios-v2.0&";

		const params = {
			track_id: trackId,
			selected_language: selectedLanguage,
		};

		const response = await request(buildRequestUrl(baseURL, params), signal);

		if (response.message?.header?.status_code !== 200) return null;

		const result = response.message.body;

		if (!result?.translations_list?.length) return null;

		return result.translations_list.map(({ translation }) => ({
			translation: translation.description,
			matchedLine: translation.matched_line,
		}));
	}

	let languageMap: Record<string, string> | null = null;
	async function getLanguages(): Promise<Record<string, string>> {
		if (languageMap) return languageMap;

		try {
			const cached = localStorage.getItem("lyrics-plus:musixmatch-languages");
			if (cached) {
				const tempMap = record(JSON.parse(cached));
				// Check cache version
				if (tempMap.__version === 1) {
					delete tempMap.__version;
					languageMap = Object.fromEntries(
						Object.entries(tempMap).flatMap(([key, value]) =>
							typeof value === "string" ? [[key, value]] : [],
						),
					);
					return languageMap;
				}
			}
		} catch (e) {
			console.warn("Failed to parse cached languages", e);
		}

		const baseURL =
			"https://apic-appmobile.musixmatch.com/ws/1.1/languages.get?app_id=mac-ios-v2.0&get_romanized_info=1&";

		try {
			const body = await request(buildRequestUrl(baseURL, {}));
			if (body?.message?.body?.language_list) {
				const languages: Record<string, string> = {};
				body.message.body.language_list.forEach((item) => {
					const lang = item.language;
					if (lang.language_name) {
						const name = lang.language_name.charAt(0).toUpperCase() + lang.language_name.slice(1);
						if (lang.language_iso_code_1) languages[lang.language_iso_code_1] = name;
						if (lang.language_iso_code_3) languages[lang.language_iso_code_3] = name;
					}
				});
				languageMap = languages;
				localStorage.setItem(
					"lyrics-plus:musixmatch-languages",
					JSON.stringify({ ...languageMap, __version: 1 }),
				);
				return languageMap;
			}
		} catch (e) {
			console.error("Failed to fetch languages", e);
		}
		return {};
	}

	return { findLyrics, getKaraoke, getSynced, getUnsynced, getTranslation, getLanguages };
})();
