/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The pure half of the popup-lyrics providers: string normalization and the
// response parsers, hoisted out of the module closure so they run under
// node --test. The fetchers in mod.tsx own the network, tokens and config and
// feed raw bodies through here. These parsers are near-verbatim from the
// classic extension and deliberately NOT shared with lyrics-plus: the
// endpoints, second-based timestamps and error-string contract all differ.

export interface Lyric {
	startTime: number | null;
	text: string;
}
export type LyricResult = { lyrics: Lyric[]; error?: undefined } | { error: string; lyrics?: undefined };

export interface TrackInfo {
	duration: number;
	album: string;
	artist: string;
	title: string;
	uri: string;
}

export const LyricUtils = {
	normalize(s: string, emptySymbol = true): string {
		const result = s
			.replace(/（/g, "(")
			.replace(/）/g, ")")
			.replace(/【/g, "[")
			.replace(/】/g, "]")
			.replace(/。/g, ". ")
			.replace(/；/g, "; ")
			.replace(/：/g, ": ")
			.replace(/？/g, "? ")
			.replace(/！/g, "! ")
			.replace(/、|，/g, ", ")
			.replace(/‘|’|′|＇/g, "'")
			.replace(/“|”/g, '"')
			.replace(/〜/g, "~")
			.replace(/·|・/g, "•");
		if (emptySymbol) {
			result.replace(/-/g, " ").replace(/\//g, " ");
		}
		return result.replace(/\s+/g, " ").trim();
	},

	removeExtraInfo(s: string): string {
		return (
			s
				.replace(/-\s+(feat|with|prod).*/i, "")
				.replace(/(\(|\[)(feat|with|prod)\.?\s+.*(\)|\])$/i, "")
				.replace(/\s-\s.*/, "")
				.trim() || s
		);
	},

	capitalize(s: string): string {
		return s.replace(/^(\w)/, ($1) => $1.toUpperCase());
	},
};

export function parseSpotifyLyrics(body: {
	lyrics?: { syncType?: string; lines?: { startTimeMs: string; words: string }[] };
}): LyricResult {
	const lyricsData = body.lyrics;
	if (!lyricsData || lyricsData.syncType !== "LINE_SYNCED") {
		return { error: "No lyrics" };
	}

	const lines = lyricsData.lines;
	const lyrics = (lines ?? []).map((a) => ({
		startTime: Number(a.startTimeMs) / 1000,
		text: a.words,
	}));

	return { lyrics };
}

// Takes body.message.body.macro_calls; the fetcher owns the token/401 dance.
// biome-ignore lint/suspicious/noExplicitAny: untyped upstream response
export function parseMusixmatchMacro(body: any): LyricResult {
	if (body?.["matcher.track.get"]?.message?.header?.status_code !== 200) {
		const head = body?.["matcher.track.get"]?.message?.header;
		return {
			error: head
				? `Requested error: ${head.status_code}: ${head.hint} - ${head.mode}`
				: "Musixmatch request failed",
		};
	}

	const meta = body["matcher.track.get"].message.body;
	const hasSynced = meta.track.has_subtitles;
	const isRestricted =
		body["track.lyrics.get"].message.header.status_code === 200 &&
		body["track.lyrics.get"].message.body.lyrics.restricted;
	const isInstrumental = meta.track.instrumental;

	if (isRestricted) return { error: "Unfortunately we're not authorized to show these lyrics." };
	if (isInstrumental) return { error: "Instrumental" };
	if (hasSynced) {
		// The classic code let a malformed subtitle_body throw into the fetcher's
		// catch, which returned { error: message } — same contract, caught here.
		try {
			const subtitle = body["track.subtitles.get"].message.body.subtitle_list[0].subtitle;
			const lyrics = JSON.parse(subtitle.subtitle_body).map(
				(line: { text: string; time: { total: number } }) => ({
					text: line.text || "♪",
					startTime: line.time.total,
				}),
			);
			return { lyrics };
		} catch (err) {
			return { error: (err as Error).message };
		}
	}

	return { error: "No lyrics" };
}

export function pickNeteaseTrack(
	items: { album: { name: string }; duration: number }[],
	info: Pick<TrackInfo, "album" | "duration">,
): number {
	const album = LyricUtils.capitalize(info.album);
	return items.findIndex(
		(val) => LyricUtils.capitalize(val.album.name) === album || Math.abs(info.duration - val.duration) < 1000,
	);
}

// Same alternation the classic build assembled with new RegExp(join("|")) —
// written out as a literal since every part is a compile-time constant.
const otherInfoRegexp =
	/^(\s?作?\s*词|\s?作?\s*曲|\s?编\s*曲?|\s?监\s*制?|.*编写|.*和音|.*和声|.*合声|.*提琴|.*录|.*工程|.*工作室|.*设计|.*剪辑|.*制作|.*发行|.*出品|.*后期|.*混音|.*缩混|原唱|翻唱|题字|文案|海报|古筝|二胡|钢琴|吉他|贝斯|笛子|鼓|弦乐|lrc|publish|vocal|guitar|program|produce|write|mix).*(:|：)/i;

export function parseNeteaseLyrics(lyricStr: string): LyricResult {
	const lines = lyricStr.split(/\r?\n/).map((line: string) => line.trim());
	let noLyrics = false;
	const lyrics = lines
		.flatMap((line: string) => {
			const matchResult = line.match(/(\[.*?\])|([^[\]]+)/g) || [line];
			if (!matchResult.length || matchResult.length === 1) {
				return;
			}
			const textIndex = matchResult.findIndex((slice) => !slice.endsWith("]"));
			let text = "";
			if (textIndex > -1) {
				text = matchResult.splice(textIndex, 1)[0];
				text = LyricUtils.capitalize(LyricUtils.normalize(text, false));
			}
			if (text === "纯音乐, 请欣赏") noLyrics = true;
			return matchResult.map((slice) => {
				const result: Partial<Lyric> = {};
				const innerMatch = slice.match(/[^[\]]+/g);
				const [key, value] = innerMatch![0].split(":") || [];
				const [min, sec] = [Number.parseFloat(key), Number.parseFloat(value)];
				if (!Number.isNaN(min) && !Number.isNaN(sec) && !otherInfoRegexp.test(text)) {
					result.startTime = min * 60 + sec;
					result.text = text || "♪";
					return result;
				}
				return;
			});
		})
		.sort((a: Lyric, b: Lyric) => {
			if (a.startTime === null) {
				return 0;
			}
			if (b.startTime === null) {
				return 1;
			}
			return a.startTime - b.startTime;
		})
		.filter(Boolean) as Lyric[];

	if (noLyrics) {
		return { error: "No lyrics" };
	}
	if (!lyrics.length) {
		return { error: "No synced lyrics" };
	}

	return { lyrics };
}

export function parseLrclibBody(meta: { instrumental?: boolean; syncedLyrics?: string }): LyricResult {
	if (meta?.instrumental) {
		return { error: "Instrumental" };
	}
	if (!meta?.syncedLyrics) {
		return { error: "No synced lyrics" };
	}

	const lines = meta.syncedLyrics
		.replaceAll(/\[[a-zA-Z]+:.+\]/g, "")
		.trim()
		.split("\n");

	const syncedTimestamp = /\[([0-9:.]+)\]/;
	const isSynced = lines[0].match(syncedTimestamp);

	const lyrics = lines.map((line: string) => {
		const time = line.match(syncedTimestamp)?.[1];
		const lyricContent = line.replace(syncedTimestamp, "").trim();
		const lyric = lyricContent.replaceAll(/<([0-9:.]+)>/g, "").trim();
		const [min, sec] = (time ?? "").replace(/\[\]<>/, "").split(":");

		if (line.trim() !== "" && isSynced && time) {
			return { text: lyric || "♪", startTime: Number(min) * 60 + Number(sec) };
		}
		return;
	}) as Lyric[];

	return { lyrics };
}
