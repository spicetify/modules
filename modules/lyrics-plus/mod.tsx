/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "lyrics-plus" custom app.
 *
 * The classic app concatenated its subfiles into one shared global scope and
 * mounted through a render() entry point. This module preserves that single
 * shared scope by concatenating the same sources, in dependency order, into
 * one module. render() is replaced by the v3 registrar mounting at the bottom.
 */

// @ts-nocheck — this is a faithful port of ~5.3k lines of upstream lyrics-plus
// JavaScript, maintained untyped across the ecosystem. Hand-annotating it would
// be disproportionate and fragile; correctness is verified live against the
// running client instead. oxlint still lints this file for real defects.

import {
	client,
	createRegistrar,
	NavLink,
	PlaybarButton,
	React as react,
	type ModuleRuntimeContext,
} from "/modules/stdlib/mod.ts";
import { SettingsSection, Tooltip } from "/modules/stdlib/lib/primitives.js";

import {
	APP_NAME,
	CONFIG,
	fontSizeLimit,
	GENIUS,
	KARAOKE,
	MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE,
	MUSIXMATCH_TRANSLATION_FETCH_MESSAGE,
	MUSIXMATCH_TRANSLATION_PREFIX,
	SYNCED,
	UNSYNCED,
} from "./config.ts";
import * as UtilsPure from "./utils.ts";
import { ProviderGenius } from "./providers/genius.ts";
import { createProviders } from "./providers/index.ts";
import { AdjustmentsMenu, TranslationMenu } from "./options-menu.tsx";
import { TopBarContent } from "./tab-bar.tsx";
import { LyricsPlusSettings, openLyricsPlusAppearanceSettings } from "./settings.tsx";
import { lyricsReplacementReady, mountLyricsPlaybarStyleWhenReady, watchLyricsHistory } from "./playbar-lifecycle.ts";
import type { LyricsHistory } from "./playbar-lifecycle.ts";
import {
	emptyLine,
	GeniusPage,
	LoadingIcon,
	SyncedExpandedLyricsPage,
	SyncedLyricsPage,
	UnsyncedLyricsPage,
} from "./pages.tsx";
import { ProviderMusixmatch } from "./providers/musixmatch.ts";
import { configureLyricsClient } from "./runtime-client.ts";

configureLyricsClient(client);

// Romanization/conversion libraries the Translator injects at runtime via
// <script> tags (kuroshiro / kuromoji / aromanize / opencc). Declared so the
// ported code type-checks and passes no-undef; they only exist once the CDN
// scripts have loaded, exactly as in the classic app.
declare const Kuroshiro: any;
declare const KuromojiAnalyzer: any;
declare const Aromanize: any;
declare const OpenCC: any;

const ROUTE = "/lyrics-plus";
const ICON =
	'<svg viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="m224.9832,74.42656q0,17.80336 -8.28326,33.3279t-22.6169,25.4232t-31.90855,12.31993l-88.73891,102.6898q-4.89793,5.69708 -12.53293,5.69708q-4.46576,0 -8.35529,-2.1364l-15.41406,-8.83047q-5.47415,-3.13339 -7.41892,-9.11532t0.5042,-11.67901l54.74154,-121.34772q-5.18604,-12.81842 -5.18604,-26.34898q0,-29.6248 21.32039,-50.70398t51.28418,-21.07918t51.28418,21.07918t21.32039,50.70398zm-158.46235,167.92132l83.26476,-96.28059q-18.72737,-0.71213 -34.50157,-10.0411t-25.13789,-24.85349l-51.57229,114.65366q-1.15245,2.56368 -0.28811,5.19858t3.3133,4.05917l15.55812,8.97289q2.30491,1.28184 4.96996,0.85456t4.39373,-2.56368zm85.85778,-105.11106q26.21832,0 44.87366,-18.44428t18.65534,-44.36598t-18.65534,-44.36598t-44.87366,-18.44428t-44.87366,18.44428t-18.65534,44.36598t18.65534,44.36598t44.87366,18.44428z"/></svg>';

// ============================================================================
// index.js — constants, CONFIG, module-level state (above LyricsContainer)
// ============================================================================

// APP_NAME, the mode constants, getConfig and the CONFIG singleton now live
// in ./config.ts.

let CACHE = {};

const emptyState = {
	karaoke: null,
	synced: null,
	unsynced: null,
	genius: null,
	genius2: null,
	currentLyrics: null,
	musixmatchAvailableTranslations: null,
	musixmatchTrackId: null,
	musixmatchTranslationLanguage: null,
};

import * as sharedCallbacks from "./shared-callbacks.ts";

function resolveTranslationSource(source) {
	if (typeof source !== "string") {
		return { key: source, language: null };
	}

	if (source.startsWith(MUSIXMATCH_TRANSLATION_PREFIX)) {
		const language = source.slice(MUSIXMATCH_TRANSLATION_PREFIX.length) || null;
		return { key: "musixmatchTranslation", language };
	}

	return { key: source, language: null };
}

// ============================================================================
// Utils.js
// ============================================================================

const Utils = {
	addQueueListener(callback) {
		client.player.origin._events.addListener("queue_update", callback);
	},
	removeQueueListener(callback) {
		client.player.origin._events.removeListener("queue_update", callback);
	},
	/**
	 * Singleton Translator instance for {@link toSimplifiedChinese}.
	 *
	 * @type {Translator | null}
	 */
	set translator(translator) {
		this._translatorInstance = translator;
	},
	_translatorInstance: null,
	/**
	 * Convert all Han characters to Simplified Chinese.
	 *
	 * Choosing Simplified Chinese makes the converted result more accurate,
	 * as the conversion from SC to TC may have multiple possibilities,
	 * while the conversion from TC to SC usually has only one possibility.
	 *
	 * @param {string} s
	 * @returns {Promise<string>}
	 */
	async toSimplifiedChinese(s) {
		// create a singleton Translator instance
		if (!this._translatorInstance) this.translator = new Translator("zh", true);

		// translate to Simplified Chinese
		// as Traditional Chinese differs between HK and TW, forcing to use OpenCC standard
		return this._translatorInstance.convertChinese(s, "t", "cn");
	},
	processTranslatedLyrics(translated, original) {
		return original.map((lyric, index) => ({
			startTime: lyric.startTime || 0,
			text: this.rubyTextToReact(translated[index]),
			originalText: lyric.text,
		}));
	},
	rubyTextToOriginalReact(translated, syncedText) {
		const react = client.react;
		return react.createElement("p1", null, [
			react.createElement("ruby", {}, syncedText, react.createElement("rt", null, translated)),
		]);
	},
	rubyTextToReact(s) {
		const react = client.react;
		const rubyElems = s.split("<ruby>");
		const reactChildren = [];

		if (rubyElems[0] !== "") reactChildren.push(rubyElems[0]);
		for (let i = 1; i < rubyElems.length; i++) {
			const kanji = rubyElems[i].split("<rp>")[0];
			const furigana = rubyElems[i].split("<rt>")[1].split("</rt>")[0];
			reactChildren.push(react.createElement("ruby", null, kanji, react.createElement("rt", null, furigana)));

			reactChildren.push(rubyElems[i].split("</ruby>")[1]);
		}
		return react.createElement("p1", null, reactChildren);
	},
};

// Re-attach the extracted helpers so the existing `Utils.*` call sites stay
// unchanged. Object.assign rather than spreading into a new literal: the
// `translator` setter above is an accessor, and a spread would flatten it to a
// plain value and break toSimplifiedChinese.
Object.assign(Utils, UtilsPure);

// parseLocalLyrics used to read this itself. It is passed in now so the parser
// stays client-free; this helper keeps the value identical to what it read.
const currentTrackDurationMs = () => Number(client.player.data?.item?.metadata?.duration) || 0;

// ============================================================================
// Translator.js
// ============================================================================

const kuroshiroPath = "https://cdn.jsdelivr.net/npm/kuroshiro@1.2.0/dist/kuroshiro.min.js";
const kuromojiPath =
	"https://cdn.jsdelivr.net/npm/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js";
const aromanize = "https://cdn.jsdelivr.net/npm/aromanize@0.1.5/aromanize.min.js";
const openCCPath = "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.min.js";

const dictPath = "https:/cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict";

class Translator {
	constructor(lang, isUsingNetease = false) {
		this.finished = {
			ja: false,
			ko: false,
			zh: false,
		};
		this.isUsingNetease = isUsingNetease;

		this.applyKuromojiFix();
		this.injectExternals(lang);
		this.createTranslator(lang);
	}

	includeExternal(url) {
		if ((CONFIG.visual.translate || this.isUsingNetease) && !document.querySelector(`script[src="${url}"]`)) {
			const script = document.createElement("script");
			script.setAttribute("type", "text/javascript");
			script.setAttribute("src", url);
			document.head.appendChild(script);
		}
	}

	injectExternals(lang) {
		switch (lang?.slice(0, 2)) {
			case "ja":
				this.includeExternal(kuromojiPath);
				this.includeExternal(kuroshiroPath);
				break;
			case "ko":
				this.includeExternal(aromanize);
				break;
			case "zh":
				this.includeExternal(openCCPath);
				break;
		}
	}

	async awaitFinished(language) {
		return new Promise((resolve) => {
			const interval = setInterval(() => {
				this.injectExternals(language);
				this.createTranslator(language);

				const lan = language.slice(0, 2);
				if (this.finished[lan]) {
					clearInterval(interval);
					resolve();
				}
			}, 100);
		});
	}

	/**
	 * Fix an issue with kuromoji when loading dict from external urls
	 * Adapted from: https://github.com/mobilusoss/textlint-browser-runner/pull/7
	 */
	applyKuromojiFix() {
		if (typeof XMLHttpRequest.prototype.realOpen !== "undefined") return;
		XMLHttpRequest.prototype.realOpen = XMLHttpRequest.prototype.open;
		XMLHttpRequest.prototype.open = function (method, url, bool) {
			if (url.indexOf(dictPath.replace("https://", "https:/")) === 0) {
				this.realOpen(method, url.replace("https:/", "https://"), bool);
			} else {
				this.realOpen(method, url, bool);
			}
		};
	}

	async createTranslator(lang) {
		switch (lang.slice(0, 2)) {
			case "ja":
				if (this.kuroshiro) return;
				if (typeof Kuroshiro === "undefined" || typeof KuromojiAnalyzer === "undefined") {
					await Translator.#sleep(50);
					return this.createTranslator(lang);
				}

				this.kuroshiro = new Kuroshiro.default();
				this.kuroshiro.init(new KuromojiAnalyzer({ dictPath })).then(
					function () {
						this.finished.ja = true;
					}.bind(this),
				);

				break;
			case "ko":
				if (this.Aromanize) return;
				if (typeof Aromanize === "undefined") {
					await Translator.#sleep(50);
					return this.createTranslator(lang);
				}

				this.Aromanize = Aromanize;
				this.finished.ko = true;
				break;
			case "zh":
				if (this.OpenCC) return;
				if (typeof OpenCC === "undefined") {
					await Translator.#sleep(50);
					return this.createTranslator(lang);
				}

				this.OpenCC = OpenCC;
				this.finished.zh = true;
				break;
		}
	}

	async romajifyText(text, target = "romaji", mode = "spaced") {
		if (!this.finished.ja) {
			await Translator.#sleep(100);
			return this.romajifyText(text, target, mode);
		}

		return this.kuroshiro.convert(text, {
			to: target,
			mode: mode,
		});
	}

	async convertToRomaja(text, target) {
		if (!this.finished.ko) {
			await Translator.#sleep(100);
			return this.convertToRomaja(text, target);
		}

		if (target === "hangul") return text;
		return Aromanize.hangulToLatin(text, "rr-translit");
	}

	async convertChinese(text, from, target) {
		if (!this.finished.zh) {
			await Translator.#sleep(100);
			return this.convertChinese(text, from, target);
		}

		const converter = this.OpenCC.Converter({
			from: from,
			to: target,
		});

		return converter(text);
	}

	/**
	 * Async wrapper of `setTimeout`.
	 *
	 * @param {number} ms
	 * @returns {Promise<void>}
	 */
	static async #sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// ============================================================================
// ============================================================================
// Providers — moved to ./providers/{musixmatch,lrclib,netease,genius}.ts
// ============================================================================

// React hook over the musixmatch token state (the state lives with the
// provider; React stays out of that file so node --test can import it).

// ============================================================================
// ============================================================================
// Providers.js — moved to ./providers/index.ts
// ============================================================================

const Providers = createProviders({
	trackDurationMs: currentTrackDurationMs,
	simplifyChinese: (s) => Utils.toSimplifiedChinese(s),
	spicetifyVersion: () => client.spicetifyVersion,
});

// ============================================================================
// OptionsMenu.js — moved to ./options-menu.tsx
// ============================================================================
// ============================================================================
// TabBar.js — moved to ./tab-bar.tsx
// ============================================================================

// ============================================================================
// Settings.js — moved to ./settings.tsx
// ============================================================================

// ============================================================================
// Pages.js — moved to ./pages.tsx
// ============================================================================

// ============================================================================
// index.js — LyricsContainer class
// ============================================================================

class LyricsContainer extends react.Component {
	constructor() {
		super();
		this.state = {
			karaoke: null,
			synced: null,
			unsynced: null,
			genius: null,
			genius2: null,
			currentLyrics: null,
			romaji: null,
			furigana: null,
			hiragana: null,
			hangul: null,
			romaja: null,
			katakana: null,
			cn: null,
			hk: null,
			tw: null,
			musixmatchTranslation: null,
			musixmatchTranslationLanguage: null,
			musixmatchAvailableTranslations: [],
			musixmatchTrackId: null,
			neteaseTranslation: null,
			uri: "",
			provider: "",
			colors: {
				background: "",
				inactive: "",
			},
			tempo: "0.25s",
			explicitMode: -1,
			lockMode: CONFIG.locked,
			mode: -1,
			isLoading: false,
			versionIndex: 0,
			versionIndex2: 0,
			isFullscreen: false,
			isFADMode: false,
			isCached: false,
			language: null,
		};
		this.currentTrackUri = "";
		this.nextTrackUri = "";
		this.availableModes = [];
		this.styleVariables = {};
		this.fullscreenContainer = document.createElement("div");
		this.fullscreenContainer.id = "lyrics-fullscreen-container";
		this.mousetrap = null;
		this.containerRef = react.createRef(null);
		this.translator = null;
		this.initMoustrap();
		// Cache last state
		this.languageOverride = CONFIG.visual["translate:detect-language-override"];
		this.translate = CONFIG.visual.translate;
		this.reRenderLyricsPage = false;
		this.displayMode = null;
		this.currentMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"];
		this._musixmatchTranslationRequestId = null;
	}

	infoFromTrack(track) {
		const meta = track?.metadata;
		if (!meta) {
			return null;
		}
		return {
			duration: Number(meta.duration),
			album: meta.album_title,
			artist: meta.artist_name,
			title: meta.title,
			uri: track.uri,
			image: meta.image_url,
		};
	}

	async fetchColors(uri) {
		let vibrant = 0;
		try {
			try {
				const { fetchExtractedColorForTrackEntity } = client.graphQL.Definitions;
				const { data } = await client.graphQL.Request(fetchExtractedColorForTrackEntity, { uri });
				const { hex } = data.trackUnion.albumOfTrack.coverArt.extractedColors.colorDark;
				vibrant = Number.parseInt(hex.replace("#", ""), 16);
			} catch {
				const colors = await client.cosmos.get(
					`https://spclient.wg.spotify.com/colorextractor/v1/extract-presets?uri=${uri}&format=json`,
				);
				vibrant = colors.entries[0].color_swatches.find(
					(color) => color.preset === "VIBRANT_NON_ALARMING",
				).color;
			}
		} catch {
			vibrant = 8747370;
		}

		this.setState({
			colors: {
				background: Utils.convertIntToRGB(vibrant),
				inactive: Utils.convertIntToRGB(vibrant, 3),
			},
		});
	}

	async fetchTempo(uri) {
		const audio = await client.cosmos.get(
			`https://spclient.wg.spotify.com/audio-attributes/v1/audio-features/${uri.split(":")[2]}?format=json`,
		);
		let tempo = audio.tempo;

		const MIN_TEMPO = 60;
		const MAX_TEMPO = 150;
		const MAX_PERIOD = 0.4;
		if (!tempo) tempo = 105;
		if (tempo < MIN_TEMPO) tempo = MIN_TEMPO;
		if (tempo > MAX_TEMPO) tempo = MAX_TEMPO;

		let period = MAX_PERIOD - ((tempo - MIN_TEMPO) / (MAX_TEMPO - MIN_TEMPO)) * MAX_PERIOD;
		period = Math.round(period * 100) / 100;

		this.setState({
			tempo: `${String(period)}s`,
		});
	}

	async refreshMusixmatchTranslation() {
		const selectedLanguage = CONFIG.visual["musixmatch-translation-language"] || "none";
		const availableTranslations = this.state.musixmatchAvailableTranslations || [];
		const trackId = this.state.musixmatchTrackId;
		const currentUri = this.state.uri;
		const currentRequestId = Symbol("musixmatchTranslationRequest");
		this._musixmatchTranslationRequestId = currentRequestId;
		const isLatestRequest = () => this._musixmatchTranslationRequestId === currentRequestId;
		const finishRequest = () => {
			if (isLatestRequest()) {
				this._musixmatchTranslationRequestId = null;
			}
		};

		const clearTranslation = () => {
			if (this.state.musixmatchTranslation !== null || this.state.musixmatchTranslationLanguage !== null) {
				this.setState({
					musixmatchTranslation: null,
					musixmatchTranslationLanguage: null,
				});
			}
			if (CACHE[currentUri]) {
				CACHE[currentUri].musixmatchTranslation = null;
				CACHE[currentUri].musixmatchTranslationLanguage = null;
			}
		};

		if (!trackId || !selectedLanguage || selectedLanguage === "none") {
			clearTranslation();
			finishRequest();
			return;
		}

		if (!availableTranslations.includes(selectedLanguage)) {
			clearTranslation();
			finishRequest();
			return;
		}

		const baseLyrics = this.state.synced ?? this.state.unsynced;
		if (!baseLyrics) {
			finishRequest();
			return;
		}

		const currentLanguage = selectedLanguage;

		client.notify(MUSIXMATCH_TRANSLATION_FETCH_MESSAGE, false, 1000);

		this.setState({
			musixmatchTranslation: null,
			musixmatchTranslationLanguage: null,
		});

		let translation;
		try {
			translation = await ProviderMusixmatch.getTranslation(trackId);
		} catch (error) {
			console.error(error);
			if (isLatestRequest()) {
				client.notify(MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE, true, 3000);
				if (CACHE[currentUri]) {
					CACHE[currentUri].musixmatchTranslation = null;
					CACHE[currentUri].musixmatchTranslationLanguage = null;
				}
			}
			finishRequest();
			return;
		}

		if (!translation) {
			if (isLatestRequest()) {
				client.notify(MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE, true, 3000);
				if (CACHE[currentUri]) {
					CACHE[currentUri].musixmatchTranslation = null;
					CACHE[currentUri].musixmatchTranslationLanguage = null;
				}
			}
			finishRequest();
			return;
		}

		if (
			currentLanguage !== CONFIG.visual["musixmatch-translation-language"] ||
			trackId !== this.state.musixmatchTrackId ||
			currentUri !== this.state.uri ||
			!isLatestRequest()
		) {
			finishRequest();
			return;
		}

		const latestBaseLyrics = this.state.synced ?? this.state.unsynced;
		if (!latestBaseLyrics) {
			finishRequest();
			return;
		}

		const mappedTranslation = latestBaseLyrics.map((line) => {
			const originalText = line.originalText ?? line.text;
			const matched = translation.find(
				(entry) => Utils.processLyrics(entry.matchedLine) === Utils.processLyrics(originalText),
			);

			return {
				...line,
				text: matched?.translation ?? line.text,
				originalText,
			};
		});

		if (!isLatestRequest()) {
			finishRequest();
			return;
		}

		this.setState({
			musixmatchTranslation: mappedTranslation,
			musixmatchTranslationLanguage: currentLanguage,
		});
		if (CACHE[currentUri]) {
			CACHE[currentUri].musixmatchTranslation = mappedTranslation;
			CACHE[currentUri].musixmatchTranslationLanguage = currentLanguage;
		}
		finishRequest();
	}

	async tryServices(trackInfo, mode = -1) {
		const currentMode = CONFIG.modes[mode] || "";
		let finalData = { ...emptyState, uri: trackInfo.uri };
		for (const id of CONFIG.providersOrder) {
			const service = CONFIG.providers[id];
			if (!service.on) continue;
			if (mode !== -1 && !service.modes.includes(mode)) continue;

			let data;
			try {
				data = await Providers[id](trackInfo);
			} catch (e) {
				console.error(e);
				continue;
			}

			if (data.error || (!data.karaoke && !data.synced && !data.unsynced && !data.genius)) continue;
			if (mode === -1) {
				finalData = data;
				return finalData;
			}

			if (!data[currentMode]) {
				for (const key in data) {
					if (!finalData[key]) {
						finalData[key] = data[key];
					}
				}
				continue;
			}

			for (const key in data) {
				if (!finalData[key]) {
					finalData[key] = data[key];
				}
			}

			if (data.provider !== "local" && finalData.provider && finalData.provider !== data.provider) {
				const styledMode = currentMode.charAt(0).toUpperCase() + currentMode.slice(1);
				finalData.copyright =
					`${styledMode} lyrics provided by ${data.provider}\n${finalData.copyright || ""}`.trim();
			}

			if (
				finalData.musixmatchTranslation &&
				typeof finalData.musixmatchTranslation[0].startTime === "undefined" &&
				finalData.synced
			) {
				finalData.musixmatchTranslation = finalData.synced.map((line) => ({
					...line,
					text:
						finalData.musixmatchTranslation.find(
							(l) => Utils.processLyrics(l.originalText) === Utils.processLyrics(line.text),
						)?.text ?? line.text,
				}));
			}

			return finalData;
		}

		return finalData;
	}

	async fetchLyrics(track, mode = -1, refresh = false) {
		const info = this.infoFromTrack(track);
		if (!info) {
			this.setState({ error: "No track info" });
			return;
		}

		let isCached = this.lyricsSaved(info.uri);

		if (CONFIG.visual.colorful) {
			this.fetchColors(info.uri);
		}

		this.fetchTempo(info.uri);
		this.resetDelay();

		let tempState;
		// if lyrics are cached
		if ((mode === -1 && CACHE[info.uri]) || CACHE[info.uri]?.[CONFIG.modes?.[mode]]) {
			tempState = { ...emptyState, ...CACHE[info.uri], isCached };
			if (CACHE[info.uri]?.mode) {
				this.state.explicitMode = CACHE[info.uri]?.mode;
				tempState = { ...tempState, mode: CACHE[info.uri]?.mode };
			}
		} else {
			this.setState({ ...emptyState, isLoading: true, isCached: false });

			const resp = await this.tryServices(info, mode);
			if (resp.provider) {
				// Cache lyrics
				CACHE[resp.uri] = resp;
			}

			// This True when the user presses the Cache Lyrics button and saves it to localStorage.
			isCached = this.lyricsSaved(resp.uri);

			// In case user skips tracks too fast and multiple callbacks
			// set wrong lyrics to current track.
			if (resp.uri === this.currentTrackUri) {
				tempState = { ...emptyState, ...resp, isLoading: false, isCached };
			} else {
				return;
			}
		}

		const selectedMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"] || "none";
		const shouldRefreshMusixmatchTranslation =
			tempState.musixmatchTrackId &&
			selectedMusixmatchLanguage !== "none" &&
			Array.isArray(tempState.musixmatchAvailableTranslations) &&
			tempState.musixmatchAvailableTranslations.includes(selectedMusixmatchLanguage) &&
			(tempState.musixmatchTranslationLanguage !== selectedMusixmatchLanguage ||
				!tempState.musixmatchTranslation);
		if (
			selectedMusixmatchLanguage !== "none" &&
			(!Array.isArray(tempState.musixmatchAvailableTranslations) ||
				!tempState.musixmatchAvailableTranslations.includes(selectedMusixmatchLanguage))
		) {
			if (
				typeof CONFIG.visual["translate:translated-lyrics-source"] === "string" &&
				CONFIG.visual["translate:translated-lyrics-source"].startsWith(MUSIXMATCH_TRANSLATION_PREFIX)
			) {
				CONFIG.visual["translate:translated-lyrics-source"] = "none";
				localStorage.setItem(`${APP_NAME}:visual:translate:translated-lyrics-source`, "none");
			}
			CONFIG.visual["musixmatch-translation-language"] = "none";
			localStorage.setItem(`${APP_NAME}:visual:musixmatch-translation-language`, "none");
		}
		const translationOverrides = shouldRefreshMusixmatchTranslation
			? { musixmatchTranslation: null, musixmatchTranslationLanguage: null }
			: {};

		let finalMode = mode;
		if (mode === -1) {
			if (this.state.explicitMode !== -1) {
				finalMode = this.state.explicitMode;
			} else if (this.state.lockMode !== -1) {
				finalMode = this.state.lockMode;
			} else {
				// Auto switch
				if (tempState.karaoke) {
					finalMode = KARAOKE;
				} else if (tempState.synced) {
					finalMode = SYNCED;
				} else if (tempState.unsynced) {
					finalMode = UNSYNCED;
				} else if (tempState.genius) {
					finalMode = GENIUS;
				}
			}
		}

		this.lyricsSource(tempState, finalMode);

		// if song changed one time
		if (tempState.uri !== this.state.uri || refresh) {
			// when a song starts for the first time and language-override is selected, the lyrics are converted to the specified language.
			// however, when switching it off again, the detected language needs to be known, so defaultLanguage has been introduced.
			const defaultLanguage = Utils.detectLanguage(this.state.currentLyrics);
			const language =
				CONFIG.visual["translate:detect-language-override"] !== "off"
					? CONFIG.visual["translate:detect-language-override"]
					: defaultLanguage;
			const friendlyLanguage =
				language &&
				new Intl.DisplayNames(["en"], { type: "language" }).of(language.split("-")[0])?.toLowerCase();
			const targetConvert = CONFIG.visual[`translation-mode:${friendlyLanguage}`];

			const isMemory = CACHE[tempState.uri]?.[targetConvert];
			if (CONFIG.visual.translate && defaultLanguage && !isMemory) {
				this.translateLyrics(language, this.state.currentLyrics, targetConvert).then((translated) => {
					const res = { [targetConvert]: translated };
					// Cache translated lyrics
					CACHE[tempState.uri] = { ...CACHE[tempState.uri], ...res };
					this.setState({ ...res });
				});
			}

			// reset and apply
			this.setState(
				{
					furigana: null,
					romaji: null,
					hiragana: null,
					katakana: null,
					hangul: null,
					romaja: null,
					cn: null,
					hk: null,
					tw: null,
					neteaseTranslation: null,
					...tempState,
					...translationOverrides,
					language: defaultLanguage,
				},
				() => {
					this.currentMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"];
					if (shouldRefreshMusixmatchTranslation) {
						this.refreshMusixmatchTranslation();
					}
				},
			);
			return;
		}

		this.setState({ ...tempState, ...translationOverrides }, () => {
			this.currentMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"];
			if (shouldRefreshMusixmatchTranslation) {
				this.refreshMusixmatchTranslation();
			}
		});
	}

	lyricsSource(lyricsState, mode) {
		if (!lyricsState) return;

		const lang = this.provideLanguageCode(this.state.currentLyrics);
		const friendlyLanguage =
			lang && new Intl.DisplayNames(["en"], { type: "language" }).of(lang.split("-")[0])?.toLowerCase();

		if (!this.displayMode) {
			this.displayMode = CONFIG.visual[`translation-mode:${friendlyLanguage}`];
		}

		// get original Lyrics
		const lyrics = lyricsState[CONFIG.modes[mode]];
		const translationSourceConfig = resolveTranslationSource(CONFIG.visual["translate:translated-lyrics-source"]);

		if (translationSourceConfig.language) {
			const translationLanguageKey = `${APP_NAME}:visual:musixmatch-translation-language`;
			const storedLanguage = localStorage.getItem(translationLanguageKey);

			if (storedLanguage !== translationSourceConfig.language) {
				localStorage.setItem(translationLanguageKey, translationSourceConfig.language);
			}

			if (CONFIG.visual["musixmatch-translation-language"] !== translationSourceConfig.language) {
				CONFIG.visual["musixmatch-translation-language"] = translationSourceConfig.language;
			}
		}

		if (CONFIG.visual.translate) {
			this.state.currentLyrics = lyricsState[CONFIG.visual[`translation-mode:${friendlyLanguage}`]] ?? lyrics;
		} else {
			this.state.currentLyrics = lyricsState[translationSourceConfig.key] ?? lyrics;
		}

		// Convert Mode re-fresh
		if (
			this.translate !== CONFIG.visual.translate ||
			this.languageOverride !== CONFIG.visual["translate:detect-language-override"] ||
			this.displayMode !== CONFIG.visual[`translation-mode:${friendlyLanguage}`]
		) {
			this.translate = CONFIG.visual.translate;
			this.languageOverride = CONFIG.visual["translate:detect-language-override"];
			this.displayMode = CONFIG.visual[`translation-mode:${friendlyLanguage}`];

			if (CONFIG.visual.translate) {
				const targetConvert = CONFIG.visual[`translation-mode:${friendlyLanguage}`];
				const isCached = CACHE[lyricsState.uri]?.[targetConvert];

				if (!isCached) {
					this.translateLyrics(lang, lyrics, targetConvert).then((translated) => {
						const res = { [targetConvert]: translated };
						// Cache translated lyrics
						CACHE[lyricsState.uri] = { ...CACHE[lyricsState.uri], ...res };
						this.setState({ ...this.state, ...res });
					});
				}
			} else {
				const resetCache = {
					furigana: null,
					romaji: null,
					hiragana: null,
					katakana: null,
					hangul: null,
					romaja: null,
					cn: null,
					hk: null,
					tw: null,
				};
				CACHE[lyricsState.uri] = { ...CACHE[lyricsState.uri], ...resetCache };
			}
		}
	}

	provideLanguageCode(lyrics) {
		if (!lyrics) return;

		if (CONFIG.visual["translate:detect-language-override"] !== "off") {
			return CONFIG.visual["translate:detect-language-override"];
		}
		if (this.state.language) {
			return this.state.language;
		}
		return Utils.detectLanguage(lyrics);
	}

	async translateLyrics(language, lyrics, targetConvert) {
		if (!language) return;

		client.notify("Converting...", false, 1000);
		if (!this.translator) {
			this.translator = new Translator(language);
		}
		await this.translator.awaitFinished(language);

		let result;
		try {
			if (language === "ja") {
				// Japanese
				const map = {
					romaji: { target: "romaji", mode: "spaced" },
					furigana: { target: "hiragana", mode: "furigana" },
					hiragana: { target: "hiragana", mode: "normal" },
					katakana: { target: "katakana", mode: "normal" },
				};

				result = await Promise.all(
					lyrics.map(
						async (lyric) =>
							await this.translator.romajifyText(
								lyric.text,
								map[targetConvert].target,
								map[targetConvert].mode,
							),
					),
				);
			} else if (language === "ko") {
				// Korean
				result = await Promise.all(
					lyrics.map(async (lyric) => await this.translator.convertToRomaja(lyric.text, "romaji")),
				);
			} else if (language === "zh-hans") {
				// Chinese (Simplified)
				const map = {
					cn: { from: "cn", target: "cn" },
					tw: { from: "cn", target: "tw" },
					hk: { from: "cn", target: "hk" },
				};

				// prevent conversion between the same language.
				if (targetConvert === "cn") {
					client.notify("No conversion is needed", false, 1000);
					return lyrics;
				}

				result = await Promise.all(
					lyrics.map(
						async (lyric) =>
							await this.translator.convertChinese(
								lyric.text,
								map[targetConvert].from,
								map[targetConvert].target,
							),
					),
				);
			} else if (language === "zh-hant") {
				// Chinese (Traditional)
				const map = {
					cn: { from: "t", target: "cn" },
					hk: { from: "t", target: "hk" },
					tw: { from: "t", target: "tw" },
				};

				// prevent conversion between the same language.
				if (targetConvert === "tw") {
					client.notify("No conversion is needed", false, 1000);
					return lyrics;
				}

				result = await Promise.all(
					lyrics.map(
						async (lyric) =>
							await this.translator.convertChinese(
								lyric.text,
								map[targetConvert].from,
								map[targetConvert].target,
							),
					),
				);
			}

			const res = Utils.processTranslatedLyrics(result, lyrics);
			client.notify("Converting...", false, 0);
			return res;
		} catch (error) {
			client.notify("Convert Error!", true);
			console.error(error);
		}
	}

	resetDelay() {
		CONFIG.visual.delay = Number(localStorage.getItem(`lyrics-delay:${client.player.data.item.uri}`)) || 0;
	}

	async onVersionChange(items, index) {
		if (this.state.mode === GENIUS) {
			this.setState({
				...emptyLine,
				genius2: this.state.genius2,
				isLoading: true,
			});
			const lyrics = await ProviderGenius.fetchLyricsVersion(items, index);
			this.setState({
				genius: lyrics,
				versionIndex: index,
				isLoading: false,
			});
		}
	}

	async onVersionChange2(items, index) {
		if (this.state.mode === GENIUS) {
			this.setState({
				...emptyLine,
				genius: this.state.genius,
				isLoading: true,
			});
			const lyrics = await ProviderGenius.fetchLyricsVersion(items, index);
			this.setState({
				genius2: lyrics,
				versionIndex2: index,
				isLoading: false,
			});
		}
	}

	saveLocalLyrics(uri, lyrics) {
		if (lyrics.genius) {
			lyrics.unsynced = lyrics.genius.split("<br>").map((lyc) => {
				return {
					text: lyc.replace(/<[^>]*>/g, ""),
				};
			});
			lyrics.genius = null;
		}

		const localLyrics = JSON.parse(localStorage.getItem(`${APP_NAME}:local-lyrics`)) || {};
		localLyrics[uri] = lyrics;
		localStorage.setItem(`${APP_NAME}:local-lyrics`, JSON.stringify(localLyrics));
		this.setState({ isCached: true });
	}

	deleteLocalLyrics(uri) {
		const localLyrics = JSON.parse(localStorage.getItem(`${APP_NAME}:local-lyrics`)) || {};
		delete localLyrics[uri];
		localStorage.setItem(`${APP_NAME}:local-lyrics`, JSON.stringify(localLyrics));
		console.log(localLyrics);
		this.setState({ isCached: false });
	}

	lyricsSaved(uri) {
		const localLyrics = JSON.parse(localStorage.getItem(`${APP_NAME}:local-lyrics`)) || {};
		return !!localLyrics[uri];
	}

	processLyricsFromFile(event) {
		const file = event.target.files;
		if (!file.length) return;
		const reader = new FileReader();

		if (file[0].size > 1024 * 1024) {
			client.notify("File too large", true);
			return;
		}

		reader.onload = (e) => {
			try {
				const localLyrics = Utils.parseLocalLyrics(e.target.result, currentTrackDurationMs());
				const parsedKeys = Object.keys(localLyrics)
					.filter((key) => localLyrics[key])
					.map((key) => key[0].toUpperCase() + key.slice(1))
					.map((key) => `<strong>${key}</strong>`);

				if (!parsedKeys.length) {
					client.notify("Nothing to load", true);
					return;
				}

				this.setState({ ...localLyrics, provider: "local" });
				CACHE[this.currentTrackUri] = { ...localLyrics, provider: "local", uri: this.currentTrackUri };
				this.saveLocalLyrics(this.currentTrackUri, localLyrics);

				client.notify(`Loaded ${parsedKeys.join(", ")} lyrics from file`);
			} catch (e) {
				console.error(e);
				client.notify("Failed to load lyrics", true);
			}
		};

		reader.onerror = (e) => {
			console.error(e);
			client.notify("Failed to read file", true);
		};

		reader.readAsText(file[0]);
		event.target.value = "";
	}
	initMoustrap() {
		if (!this.mousetrap && client.mousetrap) {
			this.mousetrap = new client.mousetrap();
		}
	}

	componentDidMount() {
		this.onQueueChange = async ({ data: queue }) => {
			this.state.explicitMode = this.state.lockMode;
			this.currentTrackUri = queue.current.uri;
			this.fetchLyrics(queue.current, this.state.explicitMode);
			this.viewPort.scrollTo(0, 0);

			// Fetch next track
			const nextTrack = queue.queued?.[0] || queue.nextUp?.[0];
			const nextInfo = this.infoFromTrack(nextTrack);
			// Debounce next track fetch
			if (!nextInfo || nextInfo.uri === this.nextTrackUri) return;
			this.nextTrackUri = nextInfo.uri;
			this.tryServices(nextInfo, this.state.explicitMode).then((resp) => {
				if (resp.provider) {
					// Cache lyrics
					CACHE[resp.uri] = resp;
				}
			});
		};

		if (client.player?.data?.item) {
			this.state.explicitMode = this.state.lockMode;
			this.currentTrackUri = client.player.data.item.uri;
			this.fetchLyrics(client.player.data.item, this.state.explicitMode);
		}

		this.updateVisualOnConfigChange();
		Utils.addQueueListener(this.onQueueChange);

		sharedCallbacks.setLyricContainerUpdate(() => {
			this.reRenderLyricsPage = !this.reRenderLyricsPage;
			this.updateVisualOnConfigChange();
			this.forceUpdate();

			if (this.currentMusixmatchLanguage !== CONFIG.visual["musixmatch-translation-language"]) {
				this.currentMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"];
				this.refreshMusixmatchTranslation();
			}
		});

		sharedCallbacks.setReloadLyrics(() => {
			CACHE = {};
			this.updateVisualOnConfigChange();
			this.forceUpdate();
			this.fetchLyrics(client.player.data.item, this.state.explicitMode, true);
		});

		this.viewPort =
			document.querySelector(".Root__main-view .os-viewport") ??
			document.querySelector(".Root__main-view .main-view-container__scroll-node");

		this.onFontSizeChange = (event) => {
			if (!event.ctrlKey) return;
			const dir = event.deltaY < 0 ? 1 : -1;
			let temp = CONFIG.visual["font-size"] + dir * fontSizeLimit.step;
			if (temp < fontSizeLimit.min) {
				temp = fontSizeLimit.min;
			} else if (temp > fontSizeLimit.max) {
				temp = fontSizeLimit.max;
			}
			CONFIG.visual["font-size"] = temp;
			localStorage.setItem("lyrics-plus:visual:font-size", temp);
			sharedCallbacks.lyricContainerUpdate?.();
		};

		this.toggleFullscreen = () => {
			const isEnabled = !this.state.isFullscreen;
			if (isEnabled) {
				document.body.append(this.fullscreenContainer);
				document.documentElement.requestFullscreen();
				this.mousetrap.bind("esc", this.toggleFullscreen);
			} else {
				this.fullscreenContainer.remove();
				document.exitFullscreen();
				this.mousetrap.unbind("esc");
			}

			this.setState({
				isFullscreen: isEnabled,
			});
		};
		this.mousetrap.reset();
		this.mousetrap.bind(CONFIG.visual["fullscreen-key"], this.toggleFullscreen);
		window.addEventListener("fad-request", sharedCallbacks.lyricContainerUpdate);
	}

	componentWillUnmount() {
		Utils.removeQueueListener(this.onQueueChange);
		this.mousetrap.reset();
		window.removeEventListener("fad-request", sharedCallbacks.lyricContainerUpdate);
	}

	updateVisualOnConfigChange() {
		this.availableModes = CONFIG.modes.filter((_, id) => {
			return Object.values(CONFIG.providers).some((p) => p.on && p.modes.includes(id));
		});

		if (!CONFIG.visual.colorful) {
			this.styleVariables = {
				"--lyrics-color-active": CONFIG.visual["active-color"],
				"--lyrics-color-inactive": CONFIG.visual["inactive-color"],
				"--lyrics-color-background": CONFIG.visual["background-color"],
				"--lyrics-highlight-background": CONFIG.visual["highlight-color"],
				"--lyrics-background-noise": CONFIG.visual.noise ? "var(--background-noise)" : "unset",
			};
		}

		this.styleVariables = {
			...this.styleVariables,
			"--lyrics-align-text": CONFIG.visual.alignment,
			"--lyrics-font-size": `${CONFIG.visual["font-size"]}px`,
			"--animation-tempo": this.state.tempo,
		};

		this.mousetrap.reset();
		this.mousetrap.bind(CONFIG.visual["fullscreen-key"], this.toggleFullscreen);
	}

	render() {
		const fadLyricsContainer = document.getElementById("fad-lyrics-plus-container");
		this.state.isFADMode = !!fadLyricsContainer;

		if (this.state.isFADMode) {
			// Text colors will be set by FAD extension
			this.styleVariables = {};
		} else if (CONFIG.visual.colorful) {
			this.styleVariables = {
				"--lyrics-color-active": "white",
				"--lyrics-color-inactive": this.state.colors.inactive,
				"--lyrics-color-background": this.state.colors.background || "transparent",
				"--lyrics-highlight-background": this.state.colors.inactive,
				"--lyrics-background-noise": CONFIG.visual.noise ? "var(--background-noise)" : "unset",
			};
		}

		this.styleVariables = {
			...this.styleVariables,
			"--lyrics-align-text": CONFIG.visual.alignment,
			"--lyrics-font-size": `${CONFIG.visual["font-size"]}px`,
			"--animation-tempo": this.state.tempo,
		};

		let mode = -1;
		if (this.state.explicitMode !== -1) {
			mode = this.state.explicitMode;
		} else if (this.state.lockMode !== -1) {
			mode = this.state.lockMode;
		} else {
			// Auto switch
			if (this.state.karaoke) {
				mode = KARAOKE;
			} else if (this.state.synced) {
				mode = SYNCED;
			} else if (this.state.unsynced) {
				mode = UNSYNCED;
			} else if (this.state.genius) {
				mode = GENIUS;
			}
		}

		let activeItem;
		let showTranslationButton;

		this.lyricsSource(this.state, mode);
		const lang = this.provideLanguageCode(this.state.currentLyrics);
		const friendlyLanguage =
			lang && new Intl.DisplayNames(["en"], { type: "language" }).of(lang.split("-")[0])?.toLowerCase();
		const hasMusixmatchLanguages =
			Array.isArray(this.state.musixmatchAvailableTranslations) &&
			this.state.musixmatchAvailableTranslations.length > 0;
		const hasTranslation =
			this.state.neteaseTranslation !== null ||
			this.state.musixmatchTranslation !== null ||
			hasMusixmatchLanguages;
		const hasPerformer = !!this.state.currentLyrics?.some((line) => line.performer);

		if (mode !== -1) {
			showTranslationButton = (friendlyLanguage || hasTranslation) && (mode === SYNCED || mode === UNSYNCED);

			if (mode === KARAOKE && this.state.karaoke) {
				activeItem = react.createElement(
					CONFIG.visual["synced-compact"] ? SyncedLyricsPage : SyncedExpandedLyricsPage,
					{
						isKara: true,
						trackUri: this.state.uri,
						lyrics: this.state.karaoke,
						provider: this.state.provider,
						copyright: this.state.copyright,
						reRenderLyricsPage: this.reRenderLyricsPage,
					},
				);
			} else if (mode === SYNCED && this.state.synced) {
				activeItem = react.createElement(
					CONFIG.visual["synced-compact"] ? SyncedLyricsPage : SyncedExpandedLyricsPage,
					{
						trackUri: this.state.uri,
						lyrics: this.state.currentLyrics,
						provider: this.state.provider,
						copyright: this.state.copyright,
						reRenderLyricsPage: this.reRenderLyricsPage,
					},
				);
			} else if (mode === UNSYNCED && this.state.unsynced) {
				activeItem = react.createElement(UnsyncedLyricsPage, {
					trackUri: this.state.uri,
					lyrics: this.state.currentLyrics,
					provider: this.state.provider,
					copyright: this.state.copyright,
					reRenderLyricsPage: this.reRenderLyricsPage,
				});
			} else if (mode === GENIUS && this.state.genius) {
				activeItem = react.createElement(GeniusPage, {
					isSplitted: CONFIG.visual["dual-genius"],
					trackUri: this.state.uri,
					lyrics: this.state.genius,
					provider: this.state.provider,
					copyright: this.state.copyright,
					versions: this.state.versions,
					versionIndex: this.state.versionIndex,
					onVersionChange: this.onVersionChange.bind(this),
					lyrics2: this.state.genius2,
					versionIndex2: this.state.versionIndex2,
					onVersionChange2: this.onVersionChange2.bind(this),
					reRenderLyricsPage: this.reRenderLyricsPage,
				});
			}
		}

		if (!activeItem) {
			activeItem = react.createElement(
				"div",
				{
					className: "lyrics-lyricsContainer-LyricsUnavailablePage",
				},
				react.createElement(
					"span",
					{
						className: "lyrics-lyricsContainer-LyricsUnavailableMessage",
					},
					this.state.isLoading ? LoadingIcon : "(• _ • )",
				),
			);
		}

		this.state.mode = mode;

		const out = react.createElement(
			"div",
			{
				className: `lyrics-lyricsContainer-LyricsContainer${CONFIG.visual["fade-blur"] ? " blur-enabled" : ""}${
					fadLyricsContainer ? " fad-enabled" : ""
				}`,
				style: this.styleVariables,
				ref: (el) => {
					if (!el) return;
					el.onmousewheel = this.onFontSizeChange;
				},
			},
			react.createElement("div", {
				className: "lyrics-lyricsContainer-LyricsBackground",
			}),
			react.createElement(
				"div",
				{
					className: "lyrics-config-button-container",
				},
				showTranslationButton &&
					react.createElement(TranslationMenu, {
						friendlyLanguage,
						hasTranslation: {
							musixmatch: this.state.musixmatchTranslation !== null,
							netease: this.state.neteaseTranslation !== null,
						},
						musixmatchLanguages: this.state.musixmatchAvailableTranslations || [],
						musixmatchSelectedLanguage:
							this.state.musixmatchTranslationLanguage ||
							CONFIG.visual["musixmatch-translation-language"],
					}),
				react.createElement(AdjustmentsMenu, { mode, hasPerformer }),
				react.createElement(
					Tooltip,
					{
						label: "Lyrics Plus appearance",
					},
					react.createElement(
						"button",
						{
							className: "lyrics-config-button",
							"aria-label": "Lyrics Plus appearance",
							onClick: openLyricsPlusAppearanceSettings,
						},
						react.createElement(
							"svg",
							{
								width: 16,
								height: 16,
								viewBox: "0 0 16 16",
								fill: "none",
								stroke: "currentColor",
								strokeWidth: 1.5,
								strokeLinecap: "round",
							},
							react.createElement("path", { d: "M2 4h12M2 8h12M2 12h12M5 2v4M11 6v4M7 10v4" }),
						),
					),
				),
				react.createElement(
					Tooltip,
					{
						label: this.state.isCached ? "Lyrics cached" : "Cache lyrics",
					},
					react.createElement(
						"button",
						{
							className: "lyrics-config-button",
							"aria-label": this.state.isCached ? "Lyrics cached" : "Cache lyrics",
							onClick: () => {
								const { synced, unsynced, karaoke, genius } = this.state;
								if (!synced && !unsynced && !karaoke && !genius) {
									client.notify("No lyrics to cache", true);
									return;
								}

								if (this.state.isCached) {
									this.deleteLocalLyrics(this.currentTrackUri);
									client.notify("Delete lyrics cache");
								} else {
									this.saveLocalLyrics(this.currentTrackUri, { synced, unsynced, karaoke, genius });
									client.notify("Lyrics cached");
								}
							},
						},
						react.createElement("svg", {
							width: 16,
							height: 16,
							viewBox: "0 0 16 16",
							fill: "currentColor",
							dangerouslySetInnerHTML: {
								__html: client.icons[this.state.isCached ? "downloaded" : "download"],
							},
						}),
					),
				),
				react.createElement(
					Tooltip,
					{
						label: "Load lyrics from file",
					},
					react.createElement(
						"button",
						{
							className: "lyrics-config-button",
							"aria-label": "Load lyrics from file",
							onClick: () => {
								document.getElementById("lyrics-file-input").click();
							},
						},
						react.createElement("input", {
							type: "file",
							id: "lyrics-file-input",
							accept: ".lrc,.txt",
							onChange: this.processLyricsFromFile.bind(this),
							style: {
								display: "none",
							},
						}),
						react.createElement("svg", {
							width: 16,
							height: 16,
							viewBox: "0 0 16 16",
							fill: "currentColor",
							dangerouslySetInnerHTML: {
								__html: client.icons["plus-alt"],
							},
						}),
					),
				),
			),
			activeItem,
			react.createElement(TopBarContent, {
				links: this.availableModes,
				activeLink: CONFIG.modes[mode],
				lockLink: CONFIG.modes[this.state.lockMode],
				switchCallback: (label) => {
					const mode = CONFIG.modes.findIndex((a) => a === label);
					if (mode !== this.state.mode) {
						// If explicitMode is not set, moving the topBar will apply the default mode value for the selected song.
						const info = this.infoFromTrack(client.player.data.item);
						if (info?.uri && CACHE[info?.uri]) {
							CACHE[info.uri].mode = mode;
						}

						this.setState({ explicitMode: mode });
						if (this.state.provider !== "local") this.fetchLyrics(client.player.data.item, mode);
					}
				},
				lockCallback: (label) => {
					let mode = CONFIG.modes.findIndex((a) => a === label);
					if (mode === this.state.lockMode) {
						mode = -1;
					}
					this.setState({ explicitMode: mode, lockMode: mode });
					this.fetchLyrics(client.player.data.item, mode);
					CONFIG.locked = mode;
					localStorage.setItem("lyrics-plus:lock-mode", mode);
				},
			}),
		);

		if (this.state.isFullscreen) return client.reactDOM.createPortal(out, this.fullscreenContainer);
		if (fadLyricsContainer) return client.reactDOM.createPortal(out, fadLyricsContainer);
		return out;
	}
}

// ============================================================================
// PlaybarButton.js (adapted) — v3 registrar-owned React control
// ============================================================================

const PLAYBAR_ICON = `<path d="M13.426 2.574a2.831 2.831 0 0 0-4.797 1.55l3.247 3.247a2.831 2.831 0 0 0 1.55-4.797zM10.5 8.118l-2.619-2.62A63303.13 63303.13 0 0 0 4.74 9.075L2.065 12.12a1.287 1.287 0 0 0 1.816 1.816l3.06-2.688 3.56-3.129zM7.12 4.094a4.331 4.331 0 1 1 4.786 4.786l-3.974 3.493-3.06 2.689a2.787 2.787 0 0 1-3.933-3.933l2.676-3.045 3.505-3.99z"></path>`;

function LyricsPlusPlaybarButton() {
	const [history, setHistory] = react.useState<LyricsHistory | null>(null);
	const [visible, setVisible] = react.useState(client.storage.get("lyrics-plus:visual:playbar-button") === "true");
	const [active, setActive] = react.useState(false);

	react.useEffect(
		() =>
			watchLyricsHistory(
				() => client.platform?.History,
				setHistory,
				(pathname) => setActive(pathname === ROUTE),
			),
		[],
	);

	react.useEffect(() => {
		const onToggle = (event: any) => {
			if (event.detail?.name === "playbar-button") setVisible(Boolean(event.detail.value));
		};
		window.addEventListener("lyrics-plus", onToggle);
		return () => window.removeEventListener("lyrics-plus", onToggle);
	}, []);

	const ready = lyricsReplacementReady(visible, history);
	react.useEffect(() => mountLyricsPlaybarStyleWhenReady(document, ROUTE, visible, history), [visible, history]);

	if (!ready) return null;
	return react.createElement(PlaybarButton, {
		label: "Lyrics Plus",
		icon: PLAYBAR_ICON,
		isActive: active,
		onClick: () => (history.location.pathname !== ROUTE ? history.push(ROUTE) : history.goBack()),
	});
}

// ============================================================================
// v3 mount — replaces the classic render() entry point
// ============================================================================

export default function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register(
		"navlink",
		react.createElement(NavLink, { localizedApp: "Lyrics", appRoutePath: ROUTE, icon: ICON, activeIcon: ICON }),
	);
	registrar.registerRoute(ROUTE, react.createElement(LyricsContainer));
	registrar.register("playbarButton", react.createElement(LyricsPlusPlaybarButton));
	registrar.register(
		"settingsSection",
		react.createElement(SettingsSection, { title: "Lyrics Plus" }, react.createElement(LyricsPlusSettings)),
	);
}
