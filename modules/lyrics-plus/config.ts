/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @ts-nocheck — extracted verbatim from the untyped lyrics-plus port; see the
// header note in mod.tsx. Typing the ported code is out of scope.

// CONFIG is a shared mutable singleton: it is read ~134 times and written at
// runtime (the musixmatch token). Exporting the one object keeps identity and
// mutation semantics identical to the concatenated original.
//
// Keep this file free of client references so the purity grep in the plan's
// Verification Contract stays a plain token search.

export const APP_NAME = "lyrics-plus";

const MUSIXMATCH_TRANSLATION_PREFIX_DEFAULT = "musixmatchTranslation:";
const MUSIXMATCH_TRANSLATION_PREFIX_GLOBAL_KEY = "__lyricsPlusMusixmatchTranslationPrefix";

export const MUSIXMATCH_TRANSLATION_PREFIX =
	typeof window !== "undefined" && typeof window[MUSIXMATCH_TRANSLATION_PREFIX_GLOBAL_KEY] === "string"
		? window[MUSIXMATCH_TRANSLATION_PREFIX_GLOBAL_KEY]
		: MUSIXMATCH_TRANSLATION_PREFIX_DEFAULT;

if (typeof window !== "undefined") {
	window[MUSIXMATCH_TRANSLATION_PREFIX_GLOBAL_KEY] = MUSIXMATCH_TRANSLATION_PREFIX;
}

export const MUSIXMATCH_TRANSLATION_FETCH_MESSAGE = "Fetching translation...";
export const MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE =
	"Failed to fetch translation, please try again in a few minutes";

export const KARAOKE = 0;
export const SYNCED = 1;
export const UNSYNCED = 2;
export const GENIUS = 3;

export function getConfig(name, defaultVal = true) {
	const value = localStorage.getItem(name);
	return value ? value === "true" : defaultVal;
}

export const CONFIG = {
	visual: {
		"playbar-button": getConfig("lyrics-plus:visual:playbar-button", false),
		colorful: getConfig("lyrics-plus:visual:colorful"),
		noise: getConfig("lyrics-plus:visual:noise"),
		"background-color": localStorage.getItem("lyrics-plus:visual:background-color") || "var(--spice-main)",
		"active-color": localStorage.getItem("lyrics-plus:visual:active-color") || "var(--spice-text)",
		"inactive-color":
			localStorage.getItem("lyrics-plus:visual:inactive-color") || "rgba(var(--spice-rgb-subtext),0.5)",
		"highlight-color": localStorage.getItem("lyrics-plus:visual:highlight-color") || "var(--spice-button)",
		alignment: localStorage.getItem("lyrics-plus:visual:alignment") || "center",
		"lines-before": localStorage.getItem("lyrics-plus:visual:lines-before") || "0",
		"lines-after": localStorage.getItem("lyrics-plus:visual:lines-after") || "2",
		"font-size": localStorage.getItem("lyrics-plus:visual:font-size") || "32",
		"translate:translated-lyrics-source":
			localStorage.getItem("lyrics-plus:visual:translate:translated-lyrics-source") || "none",
		"translate:display-mode": localStorage.getItem("lyrics-plus:visual:translate:display-mode") || "replace",
		"translate:detect-language-override":
			localStorage.getItem("lyrics-plus:visual:translate:detect-language-override") || "off",
		"translation-mode:japanese": localStorage.getItem("lyrics-plus:visual:translation-mode:japanese") || "furigana",
		"translation-mode:korean": localStorage.getItem("lyrics-plus:visual:translation-mode:korean") || "romaja",
		"translation-mode:chinese": localStorage.getItem("lyrics-plus:visual:translation-mode:chinese") || "cn",
		translate: getConfig("lyrics-plus:visual:translate", false),
		"ja-detect-threshold": localStorage.getItem("lyrics-plus:visual:ja-detect-threshold") || "40",
		"hans-detect-threshold": localStorage.getItem("lyrics-plus:visual:hans-detect-threshold") || "40",
		"musixmatch-translation-language":
			localStorage.getItem("lyrics-plus:visual:musixmatch-translation-language") || "none",
		"fade-blur": getConfig("lyrics-plus:visual:fade-blur"),
		"fullscreen-key": localStorage.getItem("lyrics-plus:visual:fullscreen-key") || "f12",
		"show-performers": getConfig("lyrics-plus:visual:show-performers", true),
		"synced-compact": getConfig("lyrics-plus:visual:synced-compact"),
		"dual-genius": getConfig("lyrics-plus:visual:dual-genius"),
		"global-delay": Number(localStorage.getItem("lyrics-plus:visual:global-delay")) || 0,
		delay: 0,
	},
	providers: {
		lrclib: {
			on: getConfig("lyrics-plus:provider:lrclib:on"),
			desc: "Lyrics sourced from lrclib.net. Supports both synced and unsynced lyrics. LRCLIB is a free and open-source lyrics provider.",
			modes: [SYNCED, UNSYNCED],
		},
		musixmatch: {
			on: getConfig("lyrics-plus:provider:musixmatch:on"),
			desc: "Fully compatible with Spotify. If lyrics stop loading, refresh the token below.",
			token:
				localStorage.getItem("lyrics-plus:provider:musixmatch:token") ||
				"21051986b9886beabe1ce01c3ce94c96319411f8f2c122676365e3",
			modes: [KARAOKE, SYNCED, UNSYNCED],
		},
		spotify: {
			on: getConfig("lyrics-plus:provider:spotify:on"),
			desc: "Lyrics sourced from official Spotify API.",
			modes: [SYNCED, UNSYNCED],
		},
		netease: {
			on: getConfig("lyrics-plus:provider:netease:on", false),
			desc: "Crowdsourced lyrics provider ran by Chinese developers and users.",
			modes: [KARAOKE, SYNCED, UNSYNCED],
		},
		local: {
			on: getConfig("lyrics-plus:provider:local:on"),
			desc: "Provide lyrics from cache/local files loaded from previous Spotify sessions.",
			modes: [KARAOKE, SYNCED, UNSYNCED],
		},
	},
	providersOrder: localStorage.getItem("lyrics-plus:services-order"),
	modes: ["karaoke", "synced", "unsynced", "genius"],
	locked: localStorage.getItem("lyrics-plus:lock-mode") || "-1",
};

try {
	CONFIG.providersOrder = JSON.parse(CONFIG.providersOrder);
	const providerKeys = Object.keys(CONFIG.providers);
	if (
		!Array.isArray(CONFIG.providersOrder) ||
		providerKeys.length !== CONFIG.providersOrder.length ||
		new Set(CONFIG.providersOrder).size !== providerKeys.length ||
		CONFIG.providersOrder.some((provider) => !providerKeys.includes(provider))
	) {
		throw "";
	}
} catch {
	CONFIG.providersOrder = Object.keys(CONFIG.providers);
	localStorage.setItem("lyrics-plus:services-order", JSON.stringify(CONFIG.providersOrder));
}

CONFIG.locked = Number.parseInt(CONFIG.locked);
CONFIG.visual["lines-before"] = Number.parseInt(CONFIG.visual["lines-before"]);
CONFIG.visual["lines-after"] = Number.parseInt(CONFIG.visual["lines-after"]);
CONFIG.visual["font-size"] = Number.parseInt(CONFIG.visual["font-size"]);
CONFIG.visual["ja-detect-threshold"] = Number.parseInt(CONFIG.visual["ja-detect-threshold"]);
CONFIG.visual["hans-detect-threshold"] = Number.parseInt(CONFIG.visual["hans-detect-threshold"]);

if (CONFIG.visual["translate:translated-lyrics-source"] === "musixmatchTranslation") {
	const language = CONFIG.visual["musixmatch-translation-language"];
	const normalizedLanguage = language && language !== "none" ? language : "none";
	const upgradedValue =
		normalizedLanguage !== "none" ? `${MUSIXMATCH_TRANSLATION_PREFIX}${normalizedLanguage}` : "none";
	CONFIG.visual["translate:translated-lyrics-source"] = upgradedValue;
	localStorage.setItem(`${APP_NAME}:visual:translate:translated-lyrics-source`, upgradedValue);
}

if (typeof CONFIG.visual["translate:translated-lyrics-source"] === "string") {
	const sourceValue = CONFIG.visual["translate:translated-lyrics-source"];
	if (sourceValue.startsWith(MUSIXMATCH_TRANSLATION_PREFIX)) {
		const language = sourceValue.slice(MUSIXMATCH_TRANSLATION_PREFIX.length) || "none";
		if (CONFIG.visual["musixmatch-translation-language"] !== language) {
			CONFIG.visual["musixmatch-translation-language"] = language;
			localStorage.setItem(`${APP_NAME}:visual:musixmatch-translation-language`, language);
		}
	}
}

if (
	CONFIG.visual.translate &&
	typeof CONFIG.visual["translate:translated-lyrics-source"] === "string" &&
	CONFIG.visual["translate:translated-lyrics-source"] !== "none"
) {
	CONFIG.visual.translate = false;
	localStorage.setItem(`${APP_NAME}:visual:translate`, "false");
}

// Slider bounds shared by the settings page, the options menu and the
// font-size hotkeys in LyricsContainer.
export const fontSizeLimit = { min: 16, max: 256, step: 4 };
export const thresholdSizeLimit = { min: 0, max: 100, step: 5 };
