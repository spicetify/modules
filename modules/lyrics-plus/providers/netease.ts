/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// NetEase: crowdsourced karaoke/synced/translated lyrics. The Han
// simplification helper is injected by the caller (it constructs a
// Translator, which is deliberately not part of this slice — plan KTD6).

import { capitalize, containsHanCharacter, normalize, removeExtraInfo, removeSongFeat } from "../utils.ts";
import { getLyricsResponse, requestLyrics } from "../runtime-client.ts";

import type { KaraokeLine, LyricLine, LyricWord, TimedLyricLine, TrackInfo } from "../types.ts";

interface NeteaseLyrics {
	klyric?: { lyric?: string };
	lrc?: { lyric?: string };
	tlyric?: { lyric?: string };
}

function parseLyrics(value: unknown): NeteaseLyrics {
	if (!value || typeof value !== "object") return {};
	function lyric(part: unknown): { lyric?: string } | undefined {
		return part && typeof part === "object" && "lyric" in part && typeof part.lyric === "string"
			? { lyric: part.lyric }
			: undefined;
	}
	return {
		klyric: lyric("klyric" in value ? value.klyric : undefined),
		lrc: lyric("lrc" in value ? value.lrc : undefined),
		tlyric: lyric("tlyric" in value ? value.tlyric : undefined),
	};
}

interface NeteaseSong {
	id: number;
	name: string;
	duration: number;
	album: { name: string };
}

function isSong(value: unknown): value is NeteaseSong {
	return (
		!!value &&
		typeof value === "object" &&
		"id" in value &&
		typeof value.id === "number" &&
		"name" in value &&
		typeof value.name === "string" &&
		"duration" in value &&
		typeof value.duration === "number" &&
		"album" in value &&
		!!value.album &&
		typeof value.album === "object" &&
		"name" in value.album &&
		typeof value.album.name === "string"
	);
}

export const ProviderNetease = (() => {
	const requestHeader = {
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:93.0) Gecko/20100101 Firefox/93.0",
	};

	async function findLyrics(
		info: TrackInfo,
		toSimplifiedChinese: (value: string) => Promise<string>,
		signal?: AbortSignal,
	): Promise<NeteaseLyrics> {
		const searchURL = "https://music.xianqiao.wang/neteaseapiv2/search?limit=10&type=1&keywords=";
		const lyricURL = "https://music.xianqiao.wang/neteaseapiv2/lyric?id=";

		const cleanTitle = removeExtraInfo(removeSongFeat(normalize(info.title)));
		const finalURL = searchURL + encodeURIComponent(`${cleanTitle} ${info.artist}`);

		const searchResults: unknown = await getLyricsResponse(finalURL, signal, undefined, requestHeader);
		const items =
			searchResults &&
			typeof searchResults === "object" &&
			"result" in searchResults &&
			searchResults.result &&
			typeof searchResults.result === "object" &&
			"songs" in searchResults.result &&
			Array.isArray(searchResults.result.songs)
				? searchResults.result.songs.filter(isSong)
				: [];
		if (!items?.length) {
			throw "Cannot find track";
		}

		// normalized expected album name
		const neAlbumName = normalize(info.album);
		const expectedAlbumName = containsHanCharacter(neAlbumName)
			? await requestLyrics(() => toSimplifiedChinese(neAlbumName), signal)
			: neAlbumName;
		let itemId = items.findIndex((val) => normalize(val.album.name) === expectedAlbumName);
		if (itemId === -1) itemId = items.findIndex((val) => Math.abs(info.duration - val.duration) < 3000);
		if (itemId === -1) itemId = items.findIndex((val) => val.name === cleanTitle);
		if (itemId === -1) throw "Cannot find track";

		return parseLyrics(await getLyricsResponse(lyricURL + items[itemId].id, signal, undefined, requestHeader));
	}

	const creditInfo = [
		"\\s?作?\\s*词|\\s?作?\\s*曲|\\s?编\\s*曲?|\\s?监\\s*制?",
		".*编写|.*和音|.*和声|.*合声|.*提琴|.*录|.*工程|.*工作室|.*设计|.*剪辑|.*制作|.*发行|.*出品|.*后期|.*混音|.*缩混",
		"原唱|翻唱|题字|文案|海报|古筝|二胡|钢琴|吉他|贝斯|笛子|鼓|弦乐",
		"lrc|publish|vocal|guitar|program|produce|write|mix",
	];
	const creditInfoRegExp = new RegExp(`^(${creditInfo.join("|")}).*(:|：)`, "i");

	function containCredits(text: string) {
		return creditInfoRegExp.test(text);
	}

	function parseTimestamp(line: string): { text: string; time?: string } {
		// ["[ar:Beyond]"]
		// ["[03:10]"]
		// ["[03:10]", "lyrics"]
		// ["lyrics"]
		// ["[03:10]", "[03:10]", "lyrics"]
		// ["[1235,300]", "lyrics"]
		const matchResult = line.match(/(\[.*?\])|([^[\]]+)/g);
		if (!matchResult?.length || matchResult.length === 1) {
			return { text: line };
		}

		const textIndex = matchResult.findIndex((slice) => !slice.endsWith("]"));
		let text = "";

		if (textIndex > -1) {
			text = matchResult.splice(textIndex, 1)[0];
			text = capitalize(normalize(text, false));
		}

		const time = matchResult[0].replace("[", "").replace("]", "");

		return { time, text };
	}

	function breakdownLine(text: string): LyricWord[] {
		// (0,508)Don't(0,1) (0,151)want(0,1) (0,162)to(0,1) (0,100)be(0,1) (0,157)an(0,1)
		const components = text.split(/\(\d+,(\d+)\)/g);
		// ["", "508", "Don't", "1", " ", "151", "want" , "1" ...]
		const result = [];
		for (let i = 1; i < components.length; i += 2) {
			if (components[i + 1] === " ") continue;
			result.push({
				word: `${components[i + 1]} `,
				time: Number.parseInt(components[i]),
			});
		}
		return result;
	}

	function getKaraoke(list: NeteaseLyrics): KaraokeLine[] | null {
		const lyricStr = list?.klyric?.lyric;

		if (!lyricStr) {
			return null;
		}

		const lines = lyricStr.split(/\r?\n/).map((line) => line.trim());
		const karaoke = lines
			.map((line) => {
				const { time, text } = parseTimestamp(line);
				if (!time || !text) return null;

				const [key, value] = time.split(",") || [];
				const [start, durr] = [Number.parseFloat(key), Number.parseFloat(value)];

				if (!Number.isNaN(start) && !Number.isNaN(durr) && !containCredits(text)) {
					return {
						startTime: start,
						// endTime: start + durr,
						text: breakdownLine(text),
					};
				}
				return null;
			})
			.filter((line) => line !== null);

		if (!karaoke.length) {
			return null;
		}

		return karaoke;
	}

	function getSynced(list: NeteaseLyrics): TimedLyricLine[] | null {
		const lyricStr = list?.lrc?.lyric;
		let noLyrics = false;

		if (!lyricStr) {
			return null;
		}

		const lines = lyricStr.split(/\r?\n/).map((line) => line.trim());
		const lyrics = lines
			.map((line) => {
				const { time, text } = parseTimestamp(line);
				if (text === "纯音乐, 请欣赏") noLyrics = true;
				if (!time || !text) return null;

				const [key, value] = time.split(":") || [];
				const [min, sec] = [Number.parseFloat(key), Number.parseFloat(value)];
				if (!Number.isNaN(min) && !Number.isNaN(sec) && !containCredits(text)) {
					return {
						startTime: (min * 60 + sec) * 1000,
						text: text || "",
					};
				}
				return null;
			})
			.filter((line) => line !== null);

		if (!lyrics.length || noLyrics) {
			return null;
		}
		return lyrics;
	}

	function getTranslation(list: NeteaseLyrics): TimedLyricLine[] | null {
		const lyricStr = list?.tlyric?.lyric;

		if (!lyricStr) {
			return null;
		}

		const lines = lyricStr.split(/\r?\n/).map((line) => line.trim());
		const translation = lines
			.map((line) => {
				const { time, text } = parseTimestamp(line);
				if (!time || !text) return null;

				const [key, value] = time.split(":") || [];
				const [min, sec] = [Number.parseFloat(key), Number.parseFloat(value)];
				if (!Number.isNaN(min) && !Number.isNaN(sec) && !containCredits(text)) {
					return {
						startTime: (min * 60 + sec) * 1000,
						text: text || "",
					};
				}
				return null;
			})
			.filter((line) => line !== null);

		if (!translation.length) {
			return null;
		}
		return translation;
	}

	function getUnsynced(list: NeteaseLyrics): LyricLine[] | null {
		const lyricStr = list?.lrc?.lyric;
		let noLyrics = false;

		if (!lyricStr) {
			return null;
		}

		const lines = lyricStr.split(/\r?\n/).map((line) => line.trim());
		const lyrics = lines
			.map((line) => {
				const parsed = parseTimestamp(line);
				if (parsed.text === "纯音乐, 请欣赏") noLyrics = true;
				if (!parsed.text || containCredits(parsed.text)) return null;
				return parsed;
			})
			.filter((line) => line !== null);

		if (!lyrics.length || noLyrics) {
			return null;
		}
		return lyrics;
	}

	return { findLyrics, getKaraoke, getSynced, getUnsynced, getTranslation };
})();
