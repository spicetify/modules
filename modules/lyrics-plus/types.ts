/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ReactNode } from "react";

export interface TrackInfo {
	uri: string;
	title: string;
	artist: string;
	album: string;
	duration: number;
	image?: string;
}

export interface LyricWord {
	word: string;
	time: number;
}

export interface LyricLine<Text = string> {
	text: Text;
	startTime?: number;
	endTime?: number;
	originalText?: Text | string;
	performer?: string | null;
}

export interface TimedLyricLine<Text = string> extends LyricLine<Text> {
	startTime: number;
}

export type KaraokeLine = TimedLyricLine<LyricWord[]>;
export type RenderedLyricLine = LyricLine<ReactNode>;
export type DisplayLyricLine = LyricLine<ReactNode | LyricWord[]>;
export type LyricMode = "karaoke" | "synced" | "unsynced" | "genius";
export type TranslationMode =
	| "romaji"
	| "furigana"
	| "hiragana"
	| "katakana"
	| "hangul"
	| "romaja"
	| "cn"
	| "hk"
	| "tw";
export type LyricsLanguage = "ja" | "ko" | "zh-hans" | "zh-hant";

export function isTranslationMode(value: unknown): value is TranslationMode {
	return ["romaji", "furigana", "hiragana", "katakana", "hangul", "romaja", "cn", "hk", "tw"].some(
		(mode) => mode === value,
	);
}

export function isLyricsLanguage(value: unknown): value is LyricsLanguage {
	return value === "ja" || value === "ko" || value === "zh-hans" || value === "zh-hant";
}

export interface GeniusVersion {
	title: string;
	url: string;
}

export interface ProviderResult {
	uri: string;
	karaoke?: KaraokeLine[] | null;
	synced?: TimedLyricLine[] | null;
	unsynced?: LyricLine[] | null;
	genius?: string | null;
	genius2?: string | null;
	musixmatchTranslation?: LyricLine[] | null;
	neteaseTranslation?: LyricLine[] | null;
	musixmatchAvailableTranslations?: string[] | null;
	musixmatchTrackId?: number | null;
	musixmatchTranslationLanguage?: string | null;
	provider?: string | null;
	copyright?: string | null;
	error?: string | null;
	versions?: GeniusVersion[];
	versionIndex?: number;
	versionIndex2?: number;
	mode?: number;
}
