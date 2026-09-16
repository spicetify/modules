/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
	isTranslationMode,
	type DisplayLyricLine,
	type RenderedLyricLine,
	type LyricLine,
	type TranslationMode,
	type ProviderResult,
} from "./types.ts";
import { lyricText, isKaraokeWords } from "./utils.ts";

export function translationMode(
	language: string | null | undefined,
	visual: {
		"translation-mode:japanese": string;
		"translation-mode:korean": string;
		"translation-mode:chinese": string;
	},
): TranslationMode | undefined {
	const value = language?.startsWith("ja")
		? visual["translation-mode:japanese"]
		: language?.startsWith("ko")
			? visual["translation-mode:korean"]
			: language?.startsWith("zh")
				? visual["translation-mode:chinese"]
				: undefined;
	return isTranslationMode(value) ? value : undefined;
}
function isRenderedLine(line: DisplayLyricLine): line is RenderedLyricLine {
	return !isKaraokeWords(line.text) && !isKaraokeWords(line.originalText);
}
export function renderedLines(lines: DisplayLyricLine[] | null): RenderedLyricLine[] {
	if (!lines) return [];
	if (lines.every(isRenderedLine)) return lines;
	return lines.map((line) => ({
		...line,
		text: isKaraokeWords(line.text) ? line.text.map((word) => word.word).join("") : line.text,
		originalText: isKaraokeWords(line.originalText)
			? line.originalText.map((word) => word.word).join("")
			: line.originalText,
	}));
}
export function plainLines(lines: DisplayLyricLine[] | null): LyricLine[] {
	return (lines ?? []).map((line) => ({
		...line,
		text: lyricText(line.originalText ?? line.text),
		originalText: typeof line.originalText === "string" ? line.originalText : undefined,
	}));
}
export function mergeProviderResult(target: ProviderResult, source: ProviderResult): void {
	const keys = [
		"uri",
		"karaoke",
		"synced",
		"unsynced",
		"genius",
		"genius2",
		"musixmatchTranslation",
		"neteaseTranslation",
		"musixmatchAvailableTranslations",
		"musixmatchTrackId",
		"musixmatchTranslationLanguage",
		"provider",
		"copyright",
		"error",
		"versions",
		"versionIndex",
		"versionIndex2",
		"mode",
	] satisfies (keyof ProviderResult)[];
	const copy = <K extends keyof ProviderResult>(key: K) => {
		if (Object.hasOwn(source, key) && !target[key]) target[key] = source[key];
	};
	keys.forEach(copy);
}
