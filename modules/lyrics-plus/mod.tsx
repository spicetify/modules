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

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { NavLink } from "/modules/stdlib/src/registers/navlink.tsx";

import {
	APP_NAME,
	CONFIG,
	GENIUS,
	KARAOKE,
	MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE,
	MUSIXMATCH_TRANSLATION_FETCH_MESSAGE,
	MUSIXMATCH_TRANSLATION_PREFIX,
	SYNCED,
	UNSYNCED,
} from "./config.ts";
import * as UtilsPure from "./utils.ts";
import { createProviders } from "./providers/index.ts";
import {
	ProviderMusixmatch,
	isMusixmatchTokenValid,
	musixmatchTokenListeners,
	setMusixmatchTokenValid,
} from "./providers/musixmatch.ts";

const react = Spicetify.React;
const { useState, useEffect, useCallback, useMemo, useRef } = react;
const spotifyVersion = Spicetify.Platform.version;

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
// in ./config.ts. The genius client-version gate stays here: config.ts must
// stay loadable without a client so it can be unit-tested.
if (spotifyVersion >= "1.2.31") CONFIG.providers.genius.on = false;

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

let lyricContainerUpdate;
let reloadLyrics;

const fontSizeLimit = { min: 16, max: 256, step: 4 };

const thresholdSizeLimit = { min: 0, max: 100, step: 5 };

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
		Spicetify.Player.origin._events.addListener("queue_update", callback);
	},
	removeQueueListener(callback) {
		Spicetify.Player.origin._events.removeListener("queue_update", callback);
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
		const react = Spicetify.React;
		return react.createElement("p1", null, [
			react.createElement("ruby", {}, syncedText, react.createElement("rt", null, translated)),
		]);
	},
	rubyTextToReact(s) {
		const react = Spicetify.React;
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
const currentTrackDurationMs = () => Number(Spicetify.Player.data?.item?.metadata?.duration) || 0;

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
function useMusixmatchTokenValid() {
	const [valid, setValid] = react.useState(isMusixmatchTokenValid());
	react.useEffect(() => {
		musixmatchTokenListeners.add(setValid);
		return () => {
			musixmatchTokenListeners.delete(setValid);
		};
	}, []);
	return valid;
}

// ============================================================================
// ============================================================================
// Providers.js — moved to ./providers/index.ts
// ============================================================================

const Providers = createProviders({
	trackDurationMs: currentTrackDurationMs,
	simplifyChinese: (s) => Utils.toSimplifiedChinese(s),
});

// ============================================================================
// OptionsMenu.js
// ============================================================================

const OptionsMenuItemIcon = react.createElement(
	"svg",
	{
		width: 16,
		height: 16,
		viewBox: "0 0 16 16",
		fill: "currentColor",
	},
	react.createElement("path", {
		d: "M13.985 2.383L5.127 12.754 1.388 8.375l-.658.77 4.397 5.149 9.618-11.262z",
	}),
);

const OptionsMenuItem = react.memo(({ onSelect, value, isSelected }) => {
	return react.createElement(
		Spicetify.ReactComponent.MenuItem,
		{
			onClick: onSelect,
			icon: isSelected ? OptionsMenuItemIcon : null,
			trailingIcon: isSelected ? OptionsMenuItemIcon : null,
		},
		value,
	);
});

const OptionsMenu = react.memo(({ options, onSelect, selected, defaultValue, bold = false }) => {
	/**
	 * <Spicetify.ReactComponent.ContextMenu
	 *      menu = { options.map(a => <OptionsMenuItem>) }
	 * >
	 *      <button>
	 *          <span> {select.value} </span>
	 *          <svg> arrow icon </svg>
	 *      </button>
	 * </Spicetify.ReactComponent.ContextMenu>
	 */
	const menuRef = react.useRef(null);
	return react.createElement(
		Spicetify.ReactComponent.ContextMenu,
		{
			menu: react.createElement(
				Spicetify.ReactComponent.Menu,
				{},
				options.map(({ key, value }) =>
					react.createElement(OptionsMenuItem, {
						value,
						onSelect: () => {
							onSelect(key);
							// Close menu on item click
							menuRef.current?.click();
						},
						isSelected: selected?.key === key,
					}),
				),
			),
			trigger: "click",
			action: "toggle",
			renderInline: false,
		},
		react.createElement(
			"button",
			{
				className: "optionsMenu-dropBox",
				ref: menuRef,
			},
			react.createElement(
				"span",
				{
					className: bold ? "main-type-mestoBold" : "main-type-mesto",
				},
				selected?.value || defaultValue,
			),
			react.createElement(
				"svg",
				{
					height: "16",
					width: "16",
					fill: "currentColor",
					viewBox: "0 0 16 16",
				},
				react.createElement("path", {
					d: "M3 6l5 5.794L13 6z",
				}),
			),
		),
	);
});

function getMusixmatchTranslationPrefix() {
	if (typeof window !== "undefined" && typeof window.__lyricsPlusMusixmatchTranslationPrefix === "string") {
		return window.__lyricsPlusMusixmatchTranslationPrefix;
	}

	return "musixmatchTranslation:";
}

const TranslationMenu = react.memo(
	({ friendlyLanguage, hasTranslation, musixmatchLanguages, musixmatchSelectedLanguage }) => {
		const musixmatchTranslationPrefix = getMusixmatchTranslationPrefix();

		const [languageMap, setLanguageMap] = react.useState({});

		react.useEffect(() => {
			let cancelled = false;

			if (
				typeof ProviderMusixmatch !== "undefined" &&
				ProviderMusixmatch &&
				typeof ProviderMusixmatch.getLanguages === "function"
			) {
				(async () => {
					try {
						const languages = await ProviderMusixmatch.getLanguages();
						if (!cancelled) {
							setLanguageMap(languages);
						}
					} catch (error) {
						console.error("Failed to fetch Musixmatch languages:", error);
					}
				})();
			}

			return () => {
				cancelled = true;
			};
		}, []);

		const items = useMemo(() => {
			let sourceOptions = {
				none: "None",
			};

			const translationDisplayOptions = {
				replace: "Replace original",
				below: "Below original",
			};

			const languageOptions = {
				off: "Off",
				"zh-hans": "Chinese (Simplified)",
				"zh-hant": "Chinese (Traditional)",
				ja: "Japanese",
				ko: "Korean",
			};

			let modeOptions = {
				none: "None",
			};

			const musixmatchDisplay = new Intl.DisplayNames(["en"], { type: "language" });
			const availableMusixmatchLanguages = Array.isArray(musixmatchLanguages)
				? [...new Set(musixmatchLanguages.filter(Boolean))]
				: [];
			const activeMusixmatchLanguage =
				musixmatchSelectedLanguage && musixmatchSelectedLanguage !== "none" ? musixmatchSelectedLanguage : null;
			if (hasTranslation.musixmatch && activeMusixmatchLanguage) {
				availableMusixmatchLanguages.push(activeMusixmatchLanguage);
			}

			if (availableMusixmatchLanguages.length) {
				const musixmatchOptionsArray = availableMusixmatchLanguages.map((code) => {
					let label = "";
					try {
						if (languageMap && languageMap[code]) {
							label = languageMap[code];
						} else {
							label = musixmatchDisplay.of(code) ?? code.toUpperCase();
						}
					} catch (e) {
						label = code.toUpperCase();
					}
					return {
						key: `${musixmatchTranslationPrefix}${code}`,
						label: `${label} (Musixmatch)`,
					};
				});

				musixmatchOptionsArray.sort((a, b) => a.label.localeCompare(b.label));

				const musixmatchOptions = musixmatchOptionsArray.reduce((acc, { key, label }) => {
					acc[key] = label;
					return acc;
				}, {});
				sourceOptions = { ...sourceOptions, ...musixmatchOptions };
			}

			if (hasTranslation.netease) {
				sourceOptions = {
					...sourceOptions,
					neteaseTranslation: "Chinese (Netease)",
				};
			}

			switch (friendlyLanguage) {
				case "japanese": {
					modeOptions = {
						furigana: "Furigana",
						romaji: "Romaji",
						hiragana: "Hiragana",
						katakana: "Katakana",
					};
					break;
				}
				case "korean": {
					modeOptions = {
						romaja: "Romaja",
					};
					break;
				}
				case "chinese": {
					modeOptions = {
						cn: "Simplified Chinese",
						hk: "Traditional Chinese (Hong Kong)",
						tw: "Traditional Chinese (Taiwan)",
					};
					break;
				}
			}

			const configItems = [
				{
					desc: "Translation Provider",
					key: "translate:translated-lyrics-source",
					type: ConfigSelection,
					options: sourceOptions,
					renderInline: true,
				},
				{
					desc: "Translation Display",
					key: "translate:display-mode",
					type: ConfigSelection,
					options: translationDisplayOptions,
					renderInline: true,
				},
				{
					desc: "Language Override",
					key: "translate:detect-language-override",
					type: ConfigSelection,
					options: languageOptions,
					renderInline: true,
					// for songs in languages that support translation but not Convert (e.g., English), the option is disabled.
					when: () => friendlyLanguage,
				},
				{
					desc: "Display Mode",
					key: `translation-mode:${friendlyLanguage}`,
					type: ConfigSelection,
					options: modeOptions,
					renderInline: true,
					// for songs in languages that support translation but not Convert (e.g., English), the option is disabled.
					when: () => friendlyLanguage,
				},
				{
					desc: "Convert",
					key: "translate",
					type: ConfigSlider,
					trigger: "click",
					action: "toggle",
					renderInline: true,
					// for songs in languages that support translation but not Convert (e.g., English), the option is disabled.
					when: () => friendlyLanguage,
				},
			];

			return configItems;
		}, [
			friendlyLanguage,
			hasTranslation.musixmatch,
			hasTranslation.netease,
			Array.isArray(musixmatchLanguages) ? musixmatchLanguages.join(",") : "",
			musixmatchSelectedLanguage || "",
			musixmatchTranslationPrefix,
			languageMap,
		]);

		useEffect(() => {
			// Currently opened Context Menu does not receive prop changes
			// If we were to use keys the Context Menu would close on re-render
			const event = new CustomEvent("lyrics-plus", {
				detail: {
					type: "translation-menu",
					items,
				},
			});
			document.dispatchEvent(event);
		}, [friendlyLanguage, items]);

		return react.createElement(
			Spicetify.ReactComponent.TooltipWrapper,
			{
				label: "Conversion",
			},
			react.createElement(
				"div",
				{
					className: "lyrics-tooltip-wrapper",
				},
				react.createElement(
					Spicetify.ReactComponent.ContextMenu,
					{
						menu: react.createElement(
							Spicetify.ReactComponent.Menu,
							{},
							react.createElement("h3", null, " Conversions"),
							react.createElement(OptionList, {
								type: "translation-menu",
								items,
								onChange: (name, value) => {
									if (name === "translate") {
										CONFIG.visual["translate:translated-lyrics-source"] = "none";
										localStorage.setItem(
											`${APP_NAME}:visual:translate:translated-lyrics-source`,
											"none",
										);
									}
									if (name === "translate:translated-lyrics-source") {
										const hasTranslationProvider = typeof value === "string" && value !== "none";
										if (hasTranslationProvider && CONFIG.visual.translate) {
											CONFIG.visual.translate = false;
											localStorage.setItem(`${APP_NAME}:visual:translate`, "false");
										}

										let nextMusixmatchLanguage = "none";
										if (
											typeof value === "string" &&
											value.startsWith(musixmatchTranslationPrefix)
										) {
											nextMusixmatchLanguage =
												value.slice(musixmatchTranslationPrefix.length) || "none";
										}

										if (
											CONFIG.visual["musixmatch-translation-language"] !== nextMusixmatchLanguage
										) {
											CONFIG.visual["musixmatch-translation-language"] = nextMusixmatchLanguage;
											localStorage.setItem(
												`${APP_NAME}:visual:musixmatch-translation-language`,
												nextMusixmatchLanguage,
											);
										}
									}

									CONFIG.visual[name] = value;
									localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
									lyricContainerUpdate?.();
								},
							}),
						),
						trigger: "click",
						action: "toggle",
						renderInline: true,
					},
					react.createElement(
						"button",
						{
							className: "lyrics-config-button",
						},
						react.createElement(
							"p1",
							{
								width: 16,
								height: 16,
								viewBox: "0 0 16 10.3",
								fill: "currentColor",
							},
							"⇄",
						),
					),
				),
			),
		);
	},
);

const AdjustmentsMenu = react.memo(({ mode, hasPerformer }) => {
	return react.createElement(
		Spicetify.ReactComponent.TooltipWrapper,
		{
			label: "Adjustments",
		},
		react.createElement(
			"div",
			{
				className: "lyrics-tooltip-wrapper",
			},
			react.createElement(
				Spicetify.ReactComponent.ContextMenu,
				{
					menu: react.createElement(
						Spicetify.ReactComponent.Menu,
						{},
						react.createElement("h3", null, " Adjustments"),
						react.createElement(OptionList, {
							items: [
								{
									desc: "Font size",
									key: "font-size",
									type: ConfigAdjust,
									min: fontSizeLimit.min,
									max: fontSizeLimit.max,
									step: fontSizeLimit.step,
								},
								{
									desc: "Track delay",
									key: "delay",
									type: ConfigAdjust,
									min: Number.NEGATIVE_INFINITY,
									max: Number.POSITIVE_INFINITY,
									step: 250,
									when: () => mode === SYNCED || mode === KARAOKE,
								},
								{
									desc: "Compact",
									key: "synced-compact",
									type: ConfigSlider,
									when: () => mode === SYNCED || mode === KARAOKE,
								},
								{
									desc: "Show performers",
									key: "show-performers",
									type: ConfigSlider,
									when: () =>
										hasPerformer && (mode === SYNCED || mode === KARAOKE || mode === UNSYNCED),
								},
								{
									desc: "Dual panel",
									key: "dual-genius",
									type: ConfigSlider,
									when: () => mode === GENIUS,
								},
							],
							onChange: (name, value) => {
								CONFIG.visual[name] = value;
								localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
								if (name === "delay")
									localStorage.setItem(`lyrics-delay:${Spicetify.Player.data.item.uri}`, value);
								lyricContainerUpdate?.();
							},
						}),
					),
					trigger: "click",
					action: "toggle",
					renderInline: true,
				},
				react.createElement(
					"button",
					{
						className: "lyrics-config-button",
					},
					react.createElement(
						"svg",
						{
							width: 16,
							height: 16,
							viewBox: "0 0 16 10.3",
							fill: "currentColor",
						},
						react.createElement("path", {
							d: "M 10.8125,0 C 9.7756347,0 8.8094481,0.30798341 8,0.836792 7.1905519,0.30798341 6.2243653,0 5.1875,0 2.3439941,0 0,2.3081055 0,5.15625 0,8.0001222 2.3393555,10.3125 5.1875,10.3125 6.2243653,10.3125 7.1905519,10.004517 8,9.4757081 8.8094481,10.004517 9.7756347,10.3125 10.8125,10.3125 13.656006,10.3125 16,8.0043944 16,5.15625 16,2.3123779 13.660644,0 10.8125,0 Z M 8,2.0146484 C 8.2629394,2.2503662 8.4963378,2.5183106 8.6936034,2.8125 H 7.3063966 C 7.5036622,2.5183106 7.7370606,2.2503662 8,2.0146484 Z M 6.619995,4.6875 C 6.6560059,4.3625487 6.7292481,4.0485841 6.8350831,3.75 h 2.3298338 c 0.1059572,0.2985841 0.1790772,0.6125487 0.21521,0.9375 z M 9.380005,5.625 C 9.3439941,5.9499512 9.2707519,6.2639159 9.1649169,6.5625 H 6.8350831 C 6.7291259,6.2639159 6.6560059,5.9499512 6.6198731,5.625 Z M 5.1875,9.375 c -2.3435059,0 -4.25,-1.8925781 -4.25,-4.21875 0,-2.3261719 1.9064941,-4.21875 4.25,-4.21875 0.7366944,0 1.4296875,0.1899414 2.0330809,0.5233154 C 6.2563478,2.3981934 5.65625,3.7083741 5.65625,5.15625 c 0,1.4478759 0.6000978,2.7580566 1.5643309,3.6954347 C 6.6171875,9.1850584 5.9241944,9.375 5.1875,9.375 Z M 8,8.2978516 C 7.7370606,8.0621337 7.5036622,7.7938231 7.3063966,7.4996337 H 8.6936034 C 8.4963378,7.7938231 8.2629394,8.0621338 8,8.2978516 Z M 10.8125,9.375 C 10.075806,9.375 9.3828125,9.1850584 8.7794191,8.8516847 9.7436522,7.9143066 10.34375,6.6041259 10.34375,5.15625 10.34375,3.7083741 9.7436522,2.3981934 8.7794191,1.4608154 9.3828125,1.1274414 10.075806,0.9375 10.8125,0.9375 c 2.343506,0 4.25,1.8925781 4.25,4.21875 0,2.3261719 -1.906494,4.21875 -4.25,4.21875 z m 0,0",
						}),
					),
				),
			),
		),
	);
});

// ============================================================================
// TabBar.js
// ============================================================================

class TabBarItem extends react.Component {
	onSelect(event) {
		event.preventDefault();
		this.props.switchTo(this.props.item.key);
	}
	onLock(event) {
		event.preventDefault();
		this.props.lockIn(this.props.item.key);
	}
	render() {
		return react.createElement(
			"li",
			{
				className: "lyrics-tabBar-headerItem",
				onClick: this.onSelect.bind(this),
				onDoubleClick: this.onLock.bind(this),
				onContextMenu: this.onLock.bind(this),
			},
			react.createElement(
				"a",
				{
					"aria-current": "page",
					className: `lyrics-tabBar-headerItemLink ${this.props.item.active ? "lyrics-tabBar-active" : ""}`,
					draggable: "false",
					href: "",
				},
				react.createElement(
					"span",
					{
						className: "main-type-mestoBold",
					},
					this.props.item.value,
				),
			),
		);
	}
}

const TabBarMore = react.memo(({ items, switchTo, lockIn }) => {
	const activeItem = items.find((item) => item.active);

	function onLock(event) {
		event.preventDefault();
		if (activeItem) {
			lockIn(activeItem.key);
		}
	}
	return react.createElement(
		"li",
		{
			className: `lyrics-tabBar-headerItem ${activeItem ? "lyrics-tabBar-active" : ""}`,
			onDoubleClick: onLock,
			onContextMenu: onLock,
		},
		react.createElement(OptionsMenu, {
			options: items,
			onSelect: switchTo,
			selected: activeItem,
			defaultValue: "More",
			bold: true,
		}),
	);
});

const TopBarContent = ({ links, activeLink, lockLink, switchCallback, lockCallback }) => {
	const resizeHost = document.querySelector(
		".Root__main-view .os-resize-observer-host, .Root__main-view .os-size-observer, .Root__main-view .main-view-container__scroll-node",
	);
	const [windowSize, setWindowSize] = useState(resizeHost?.clientWidth ?? window.innerWidth);
	const resizeHandler = () => setWindowSize(resizeHost?.clientWidth ?? window.innerWidth);

	useEffect(() => {
		if (!resizeHost) return;
		const observer = new ResizeObserver(resizeHandler);
		observer.observe(resizeHost);
		return () => {
			observer.disconnect();
		};
	}, [resizeHandler]);

	return react.createElement(
		TabBarContext,
		null,
		react.createElement(TabBar, {
			className: "queue-queueHistoryTopBar-tabBar",
			links,
			activeLink,
			lockLink,
			switchCallback,
			lockCallback,
			windowSize,
		}),
	);
};

const TabBarContext = ({ children }) => {
	const content = react.createElement(
		"div",
		{
			className: "main-topBar-topbarContent lyrics-plus-topbar-content",
		},
		children,
	);
	// The classic app portaled the mode switcher into the client top bar. v3 has
	// no such wrapper, so fall back to rendering it inline within the route.
	const target = document.querySelector(".main-topBar-topbarContentWrapper");
	return target ? Spicetify.ReactDOM.createPortal(content, target) : content;
};

const TabBar = react.memo(
	({ links, activeLink, lockLink, switchCallback, lockCallback, windowSize = Number.POSITIVE_INFINITY }) => {
		const tabBarRef = react.useRef(null);
		const [childrenSizes, setChildrenSizes] = useState([]);
		const [availableSpace, setAvailableSpace] = useState(0);
		const [droplistItem, setDroplistItems] = useState([]);

		const options = [];
		for (let i = 0; i < links.length; i++) {
			const key = links[i];
			if (spotifyVersion >= "1.2.31" && key === "genius") continue;
			let value = key[0].toUpperCase() + key.slice(1);
			if (key === lockLink) value = `• ${value}`;
			const active = key === activeLink;
			options.push({ key, value, active });
		}

		useEffect(() => {
			if (!tabBarRef.current) return;
			setAvailableSpace(tabBarRef.current.clientWidth);
		}, [windowSize]);

		useEffect(() => {
			if (!tabBarRef.current) return;

			const tabbarItemSizes = [];
			for (const child of tabBarRef.current.children) {
				tabbarItemSizes.push(child.clientWidth);
			}

			setChildrenSizes(tabbarItemSizes);
		}, [links]);

		useEffect(() => {
			if (!tabBarRef.current) return;

			const totalSize = childrenSizes.reduce((a, b) => a + b, 0);

			// Can we render everything?
			if (totalSize <= availableSpace) {
				setDroplistItems([]);
				return;
			}

			// The `More` button can be set to _any_ of the children. So we
			// reserve space for the largest item instead of always taking
			// the last item.
			const viewMoreButtonSize = Math.max(...childrenSizes);

			// Figure out how many children we can render while also showing
			// the More button
			const itemsToHide = [];
			let stopWidth = viewMoreButtonSize;

			childrenSizes.forEach((childWidth, i) => {
				if (availableSpace >= stopWidth + childWidth) {
					stopWidth += childWidth;
				} else {
					// First elem is edit button
					itemsToHide.push(i);
				}
			});

			setDroplistItems(itemsToHide);
		}, [availableSpace, childrenSizes]);

		return react.createElement(
			"nav",
			{
				className: "lyrics-tabBar lyrics-tabBar-nav",
			},
			react.createElement(
				"ul",
				{
					className: "lyrics-tabBar-header",
					ref: tabBarRef,
				},
				react.createElement("li", {
					className: "lyrics-tabBar-headerItem",
				}),
				options
					.filter((_, id) => !droplistItem.includes(id))
					.map((item) =>
						react.createElement(TabBarItem, {
							item,
							switchTo: switchCallback,
							lockIn: lockCallback,
						}),
					),
				droplistItem.length || childrenSizes.length === 0
					? react.createElement(TabBarMore, {
							items: droplistItem.map((i) => options[i]).filter(Boolean),
							switchTo: switchCallback,
							lockIn: lockCallback,
						})
					: null,
			),
		);
	},
);

// ============================================================================
// Settings.js
// ============================================================================

const ButtonSVG = ({ icon, active = true, onClick, disabled = false }) => {
	return react.createElement(
		"button",
		{
			className: `switch${active ? "" : " disabled"}`,
			onClick,
			disabled,
		},
		react.createElement("svg", {
			width: 16,
			height: 16,
			viewBox: "0 0 16 16",
			fill: "currentColor",
			dangerouslySetInnerHTML: {
				__html: icon,
			},
		}),
	);
};

const SwapButton = ({ icon, disabled, onClick }) => {
	return react.createElement(
		"button",
		{
			className: "switch small",
			onClick,
			disabled,
		},
		react.createElement("svg", {
			width: 10,
			height: 10,
			viewBox: "0 0 16 16",
			fill: "currentColor",
			dangerouslySetInnerHTML: {
				__html: icon,
			},
		}),
	);
};

const CacheButton = () => {
	let lyrics = {};

	try {
		const localLyrics = JSON.parse(localStorage.getItem("lyrics-plus:local-lyrics"));
		if (!localLyrics || typeof localLyrics !== "object") {
			throw "";
		}
		lyrics = localLyrics;
	} catch {
		lyrics = {};
	}

	const [count, setCount] = useState(Object.keys(lyrics).length);
	const text = count ? "Clear all cached lyrics" : "No cached lyrics";

	return react.createElement(
		"button",
		{
			className: "btn",
			onClick: () => {
				localStorage.removeItem("lyrics-plus:local-lyrics");
				setCount(0);
			},
			disabled: !count,
		},
		text,
	);
};

const RefreshTokenButton = ({ setTokenCallback }) => {
	const [buttonText, setButtonText] = useState("Refresh token");

	useEffect(() => {
		if (buttonText === "Refreshing token...") {
			Spicetify.CosmosAsync.get(
				"https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0",
				null,
				{
					Host: "apic-appmobile.musixmatch.com",
					authority: "apic-appmobile.musixmatch.com",
					"X-Cookie": "x-mxm-token-guid=",
					"x-mxm-app-version": "10.1.1",
					"X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
					"Accept-Language": "en-US,en;q=0.9",
					Connection: "keep-alive",
					Accept: "application/json",
				},
			)
				.then(({ message: response }) => {
					if (response.header.status_code === 200 && response.body.user_token) {
						setTokenCallback(response.body.user_token);
						setButtonText("Token refreshed");
					} else if (response.header.status_code === 401) {
						setButtonText("Too many attempts");
					} else {
						setButtonText("Failed to refresh token");
						console.error("Failed to refresh token", response);
					}
				})
				.catch((error) => {
					setButtonText("Failed to refresh token");
					console.error("Failed to refresh token", error);
				});
		}
	}, [buttonText]);

	return react.createElement(
		"button",
		{
			className: "btn",
			onClick: () => {
				setButtonText("Refreshing token...");
			},
			disabled: buttonText !== "Refresh token",
		},
		buttonText,
	);
};

const ConfigButton = ({ name, text, onChange = () => {} }) => {
	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(
				"button",
				{
					className: "btn",
					onClick: onChange,
				},
				text,
			),
		),
	);
};

const ConfigSlider = ({ name, defaultValue, onChange = () => {} }) => {
	const [active, setActive] = useState(defaultValue);

	useEffect(() => {
		setActive(defaultValue);
	}, [defaultValue]);

	const toggleState = useCallback(() => {
		const state = !active;
		setActive(state);
		onChange(state);
	}, [active]);

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(ButtonSVG, {
				icon: Spicetify.SVGIcons.check,
				active,
				onClick: toggleState,
			}),
		),
	);
};

const ConfigSelection = ({ name, defaultValue, options, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	const setValueCallback = useCallback(
		(event) => {
			let value = event.target.value;
			if (!Number.isNaN(Number(value))) {
				value = Number.parseInt(value);
			}
			setValue(value);
			onChange(value);
		},
		[value, options],
	);

	useEffect(() => {
		setValue(defaultValue);
	}, [defaultValue]);

	if (!Object.keys(options).length) return null;

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(
				"select",
				{
					className: "main-dropDown-dropDown",
					value,
					onChange: setValueCallback,
				},
				Object.keys(options).map((item) =>
					react.createElement(
						"option",
						{
							value: item,
						},
						options[item],
					),
				),
			),
		),
	);
};

const ConfigInput = ({ name, defaultValue, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	const setValueCallback = useCallback(
		(event) => {
			const value = event.target.value;
			setValue(value);
			onChange(value);
		},
		[value],
	);

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement("input", {
				value,
				onChange: setValueCallback,
			}),
		),
	);
};

const ConfigAdjust = ({ name, defaultValue, step, min, max, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	function adjust(dir) {
		let temp = value + dir * step;
		if (temp < min) {
			temp = min;
		} else if (temp > max) {
			temp = max;
		}
		setValue(temp);
		onChange(temp);
	}
	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(SwapButton, {
				icon: `<path d="M2 7h12v2H0z"/>`,
				onClick: () => adjust(-1),
				disabled: value === min,
			}),
			react.createElement(
				"p",
				{
					className: "adjust-value",
				},
				value,
			),
			react.createElement(SwapButton, {
				icon: Spicetify.SVGIcons.plus2px,
				onClick: () => adjust(1),
				disabled: value === max,
			}),
		),
	);
};

const ConfigHotkey = ({ name, defaultValue, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);
	const [trap] = useState(new Spicetify.Mousetrap());

	function record() {
		trap.handleKey = (character, modifiers, e) => {
			if (e.type === "keydown") {
				const sequence = [...new Set([...modifiers, character])];
				if (sequence.length === 1 && sequence[0] === "esc") {
					onChange("");
					setValue("");
					return;
				}
				setValue(sequence.join("+"));
			}
		};
	}

	function finishRecord() {
		trap.handleKey = () => {};
		onChange(value);
	}

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement("input", {
				value,
				onFocus: record,
				onBlur: finishRecord,
			}),
		),
	);
};

const ServiceAction = ({ item, setTokenCallback }) => {
	switch (item.name) {
		case "local":
			return react.createElement(CacheButton);
		case "musixmatch":
			return react.createElement(RefreshTokenButton, { setTokenCallback });
		default:
			return null;
	}
};

const ServiceOption = ({ item, onToggle, onSwap, isFirst = false, isLast = false, onTokenChange = null }) => {
	const [token, setToken] = useState(item.token);
	const [active, setActive] = useState(item.on);
	const tokenValid = useMusixmatchTokenValid();
	const musixmatchInvalid = item.name === "musixmatch" && !tokenValid;

	const setTokenCallback = useCallback(
		(token) => {
			setToken(token);
			onTokenChange(item.name, token);
			// A new token is worth re-validating, so let the next request decide.
			if (item.name === "musixmatch") setMusixmatchTokenValid(true);
		},
		[item.token],
	);

	const toggleActive = useCallback(() => {
		if (item.name === "genius" && spotifyVersion >= "1.2.31") return;
		const state = !active;
		setActive(state);
		onToggle(item.name, state);
	}, [active]);

	return react.createElement(
		"div",
		null,
		react.createElement(
			"div",
			{
				className: "setting-row",
			},
			react.createElement(
				"h3",
				{
					className: "col description",
				},
				item.name,
			),
			react.createElement(
				"div",
				{
					className: "col action",
				},
				react.createElement(ServiceAction, {
					item,
					setTokenCallback,
				}),
				react.createElement(SwapButton, {
					icon: Spicetify.SVGIcons["chart-up"],
					onClick: () => onSwap(item.name, -1),
					disabled: isFirst,
				}),
				react.createElement(SwapButton, {
					icon: Spicetify.SVGIcons["chart-down"],
					onClick: () => onSwap(item.name, 1),
					disabled: isLast,
				}),
				musixmatchInvalid
					? react.createElement(
							Spicetify.ReactComponent.TooltipWrapper,
							{
								label: "Musixmatch token is invalid and could not be refreshed automatically. Refresh the token or paste your own to re-enable it.",
							},
							react.createElement(ButtonSVG, {
								icon: Spicetify.SVGIcons.check,
								active,
								onClick: toggleActive,
								disabled: true,
							}),
						)
					: react.createElement(ButtonSVG, {
							icon: Spicetify.SVGIcons.check,
							active,
							onClick: toggleActive,
						}),
			),
		),
		react.createElement("span", {
			dangerouslySetInnerHTML: {
				__html: item.desc,
			},
		}),
		item.token !== undefined &&
			react.createElement("input", {
				placeholder: `Place your ${item.name} token here`,
				value: token,
				onChange: (event) => setTokenCallback(event.target.value),
			}),
	);
};

const ServiceList = ({ itemsList, onListChange = () => {}, onToggle = () => {}, onTokenChange = () => {} }) => {
	const [items, setItems] = useState(itemsList);
	const maxIndex = items.length - 1;

	const onSwap = useCallback(
		(name, direction) => {
			const curPos = items.findIndex((val) => val === name);
			const newPos = curPos + direction;
			[items[curPos], items[newPos]] = [items[newPos], items[curPos]];
			onListChange(items);
			setItems([...items]);
		},
		[items],
	);

	return items.map((key, index) => {
		const item = CONFIG.providers[key];
		item.name = key;
		return react.createElement(ServiceOption, {
			item,
			key,
			isFirst: index === 0,
			isLast: index === maxIndex,
			onSwap,
			onTokenChange,
			onToggle,
		});
	});
};

const corsProxyTemplate = () => {
	const [proxyValue, setProxyValue] = react.useState(
		localStorage.getItem("spicetify:corsProxyTemplate") || "https://cors-proxy.spicetify.app/{url}",
	);

	return react.createElement("input", {
		placeholder: "CORS Proxy Template",
		value: proxyValue,
		onChange: (event) => {
			const value = event.target.value;
			setProxyValue(value);

			if (value === "" || !value) return localStorage.removeItem("spicetify:corsProxyTemplate");
			localStorage.setItem("spicetify:corsProxyTemplate", value);
		},
	});
};

const OptionList = ({ type, items, onChange }) => {
	const [itemList, setItemList] = useState(items);
	const [, forceUpdate] = useState();

	useEffect(() => {
		if (!type) return;

		const eventListener = (event) => {
			if (event.detail?.type !== type) return;
			setItemList(event.detail.items);
		};
		document.addEventListener("lyrics-plus", eventListener);

		return () => document.removeEventListener("lyrics-plus", eventListener);
	}, []);

	return itemList.map((item) => {
		if (!item || (item.when && !item.when())) {
			return;
		}

		const onChangeItem = item.onChange || onChange;

		return react.createElement(
			"div",
			null,
			react.createElement(item.type, {
				...item,
				name: item.desc,
				defaultValue: CONFIG.visual[item.key],
				onChange: (value) => {
					onChangeItem(item.key, value);
					forceUpdate({});
				},
			}),
			item.info &&
				react.createElement("span", {
					dangerouslySetInnerHTML: {
						__html: item.info,
					},
				}),
		);
	});
};

function openConfig() {
	const configContainer = react.createElement(
		"div",
		{
			id: `${APP_NAME}-config-container`,
		},
		react.createElement("h2", null, "Options"),
		react.createElement(OptionList, {
			items: [
				{
					desc: "Playbar button",
					key: "playbar-button",
					info: "Replace Spotify's lyrics button with Lyrics Plus.",
					type: ConfigSlider,
				},
				{
					desc: "Global delay",
					info: "Offset (in ms) across all tracks.",
					key: "global-delay",
					type: ConfigAdjust,
					min: -10000,
					max: 10000,
					step: 250,
				},
				{
					desc: "Font size",
					info: "(or Ctrl + Mouse scroll in main app)",
					key: "font-size",
					type: ConfigAdjust,
					min: fontSizeLimit.min,
					max: fontSizeLimit.max,
					step: fontSizeLimit.step,
				},
				{
					desc: "Alignment",
					key: "alignment",
					type: ConfigSelection,
					options: {
						left: "Left",
						center: "Center",
						right: "Right",
					},
				},
				{
					desc: "Fullscreen hotkey",
					key: "fullscreen-key",
					type: ConfigHotkey,
				},
				{
					desc: "Compact synced: Lines to show before",
					key: "lines-before",
					type: ConfigSelection,
					options: [0, 1, 2, 3, 4],
				},
				{
					desc: "Compact synced: Lines to show after",
					key: "lines-after",
					type: ConfigSelection,
					options: [0, 1, 2, 3, 4],
				},
				{
					desc: "Compact synced: Fade-out blur",
					key: "fade-blur",
					type: ConfigSlider,
				},
				{
					desc: "Noise overlay",
					key: "noise",
					type: ConfigSlider,
				},
				{
					desc: "Colorful background",
					key: "colorful",
					type: ConfigSlider,
				},
				{
					desc: "Background color",
					key: "background-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Active text color",
					key: "active-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Inactive text color",
					key: "inactive-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Highlight text background",
					key: "highlight-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Text convertion: Japanese Detection threshold (Advanced)",
					info: "Checks if whenever Kana is dominant in lyrics. If the result passes the threshold, it's most likely Japanese, and vice versa. This setting is in percentage.",
					key: "ja-detect-threshold",
					type: ConfigAdjust,
					min: thresholdSizeLimit.min,
					max: thresholdSizeLimit.max,
					step: thresholdSizeLimit.step,
				},
				{
					desc: "Text convertion: Traditional-Simplified Detection threshold (Advanced)",
					info: "Checks if whenever Traditional or Simplified is dominant in lyrics. If the result passes the threshold, it's most likely Simplified, and vice versa. This setting is in percentage.",
					key: "hans-detect-threshold",
					type: ConfigAdjust,
					min: thresholdSizeLimit.min,
					max: thresholdSizeLimit.max,
					step: thresholdSizeLimit.step,
				},
				{
					desc: "Clear Memory Cache",
					info: "Loaded lyrics are cached in memory for faster reloading. Press this button to clear the cached lyrics from memory without restarting Spotify.",
					key: "clear-memore-cache",
					text: "Clear memory cache",
					type: ConfigButton,
					onChange: () => {
						reloadLyrics?.();
					},
				},
			],
			onChange: (name, value) => {
				CONFIG.visual[name] = value;
				localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
				lyricContainerUpdate?.();

				const configChange = new CustomEvent("lyrics-plus", {
					detail: {
						type: "config",
						name: name,
						value: value,
					},
				});
				window.dispatchEvent(configChange);
			},
		}),
		react.createElement("h2", null, "Providers"),
		react.createElement(ServiceList, {
			itemsList: CONFIG.providersOrder,
			onListChange: (list) => {
				CONFIG.providersOrder = list;
				localStorage.setItem(`${APP_NAME}:services-order`, JSON.stringify(list));
				reloadLyrics?.();
			},
			onToggle: (name, value) => {
				CONFIG.providers[name].on = value;
				localStorage.setItem(`${APP_NAME}:provider:${name}:on`, value);
				reloadLyrics?.();
			},
			onTokenChange: (name, value) => {
				CONFIG.providers[name].token = value;
				localStorage.setItem(`${APP_NAME}:provider:${name}:token`, value);
				reloadLyrics?.();
			},
		}),
		react.createElement("h2", null, "CORS Proxy Template"),
		react.createElement("span", {
			dangerouslySetInnerHTML: {
				__html: "Use this to bypass CORS restrictions. Replace the URL with your cors proxy server of your choice. <code>{url}</code> will be replaced with the request URL.",
			},
		}),
		react.createElement(corsProxyTemplate),
		react.createElement("span", {
			dangerouslySetInnerHTML: {
				__html: "Spotify will reload its webview after applying. Leave empty to restore default: <code>https://cors-proxy.spicetify.app/{url}</code>",
			},
		}),
	);

	Spicetify.PopupModal.display({
		title: "Lyrics Plus",
		content: configContainer,
		isLarge: true,
	});
}

// ============================================================================
// Pages.js
// ============================================================================

const CreditFooter = react.memo(({ provider, copyright }) => {
	if (provider === "local") return null;
	const credit = [Spicetify.Locale.get("web-player.lyrics.providedBy", provider)];
	if (copyright) {
		credit.push(...copyright.split("\n"));
	}

	return (
		provider &&
		react.createElement(
			"p",
			{
				className: "lyrics-lyricsContainer-Provider main-type-mesto",
				dir: "auto",
			},
			credit.join(" • "),
		)
	);
});

const IdlingIndicator = ({ isActive, progress, delay, className = "", style = {} }) => {
	return react.createElement(
		"div",
		{
			className:
				`lyrics-idling-indicator ${isActive === false ? "lyrics-idling-indicator-hidden" : ""} ${className}`.trim(),
			style: {
				"--indicator-delay": `${delay}ms`,
				...style,
			},
		},
		react.createElement("div", {
			className: `lyrics-idling-indicator__circle ${progress >= 0.05 ? "active" : ""}`,
		}),
		react.createElement("div", {
			className: `lyrics-idling-indicator__circle ${progress >= 0.33 ? "active" : ""}`,
		}),
		react.createElement("div", {
			className: `lyrics-idling-indicator__circle ${progress >= 0.66 ? "active" : ""}`,
		}),
	);
};

const emptyLine = {
	startTime: 0,
	endTime: 0,
	text: [],
};

const isPauseLine = (text) => {
	if (!text) return true;
	if (Array.isArray(text)) {
		const joined = text
			.map((w) => (typeof w === "object" ? w.word : w))
			.join("")
			.trim();
		return joined === "♪" || joined === "";
	}
	let str = typeof text === "object" ? text?.props?.children?.[0] : text;
	if (typeof str !== "string") {
		str = String(str || "");
	}
	const trimmed = str.trim();
	return trimmed === "♪" || trimmed === "";
};

const findNextLineStartTime = (lines, fromIndex) => {
	for (let j = fromIndex + 1; j < lines.length; j++) {
		if (!isPauseLine(lines[j].text) && lines[j].startTime != null) {
			return lines[j].startTime;
		}
	}
	return null;
};

const getPauseIndicator = (lyrics, lineNumber, startTime, position, isFocused, isPause) => {
	if (!isFocused || !isPause) return null;

	const nextStart = findNextLineStartTime(lyrics, lineNumber);
	const pauseStart = startTime || 0;
	const pauseDuration = nextStart ? nextStart - pauseStart : 0;
	const progress = pauseDuration > 0 ? (position - pauseStart) / pauseDuration : 0;
	const delay = pauseDuration / 3;

	return react.createElement(IdlingIndicator, {
		progress,
		delay,
	});
};

const LONG_PAUSE_THRESHOLD = 8000; // 8 seconds

const processPauseLines = (lyrics) => {
	if (!lyrics || !lyrics.length) return lyrics;
	const result = [];
	for (let i = 0; i < lyrics.length; i++) {
		const line = lyrics[i];
		const nextLine = lyrics[i + 1];

		if (isPauseLine(line.text)) {
			// Skip consecutive pause lines to consolidate them into one idling indicator
			const lastLine = result[result.length - 1];
			if (lastLine && isPauseLine(lastLine.text)) {
				continue;
			}
			const nextStart = findNextLineStartTime(lyrics, i);
			const pauseStart = line.startTime || 0;
			if (nextStart != null) {
				const pauseDuration = nextStart - pauseStart;
				if (pauseDuration >= LONG_PAUSE_THRESHOLD) {
					result.push(line);
				}
			}
		} else {
			result.push(line);
			const hasLineEndTime = line.endTime != null && line.endTime > line.startTime;
			const endTime = hasLineEndTime ? line.endTime : null;
			if (endTime != null && nextLine && nextLine.startTime != null) {
				const gap = nextLine.startTime - endTime;
				if (gap >= LONG_PAUSE_THRESHOLD && nextLine.startTime > line.startTime && !isPauseLine(nextLine.text)) {
					result.push({
						text: "♪",
						startTime: endTime,
						endTime: nextLine.startTime,
					});
				}
			}
		}
	}
	return result;
};

const isRTLText = (str) => /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(str);

const renderPerformer = (performer, previousPerformer, compact) => {
	if (!CONFIG.visual["show-performers"] || !performer || (!compact && previousPerformer === performer)) return null;
	return react.createElement("span", { className: "lyrics-lyricsContainer-Performer" }, performer);
};

const useTrackPosition = (callback) => {
	const callbackRef = useRef();
	callbackRef.current = callback;

	useEffect(() => {
		const interval = setInterval(callbackRef.current, 50);

		return () => {
			clearInterval(interval);
		};
	}, [callbackRef]);
};

const KaraokeLine = ({ text, isActive, position, startTime, endTime }) => {
	if ((endTime != null && position > endTime) || (!isActive && position > startTime)) {
		return text.map(({ word }, i) => (typeof word === "string" ? word : react.cloneElement(word, { key: i })));
	}

	let accumulatedTime = startTime;
	return text.map(({ word, time }, i) => {
		const isRTL = isRTLText(typeof word === "string" ? word : "");
		const isWordActive = position >= accumulatedTime;
		accumulatedTime += time;
		const isWordComplete = isWordActive && position >= accumulatedTime;
		return react.createElement(
			"span",
			{
				key: i,
				className: `lyrics-lyricsContainer-Karaoke-Word${isWordActive ? " lyrics-lyricsContainer-Karaoke-WordActive" : ""}${isRTL ? " lyrics-lyricsContainer-Karaoke-WordRTL" : ""}`,
				style: {
					"--word-duration": `${time}ms`,
					// don't animate unless we have to
					transition: !isWordActive || isWordComplete ? "all 0s linear" : "",
				},
			},
			word,
		);
	});
};

const SyncedLyricsPage = react.memo(({ lyrics = [], provider, copyright, isKara }) => {
	const [position, setPosition] = useState(0);
	const activeLineEle = useRef();
	const lyricContainerEle = useRef();

	useTrackPosition(() => {
		const newPos = Spicetify.Player.getProgress();
		const delay = CONFIG.visual["global-delay"] + CONFIG.visual.delay;
		if (newPos !== position) {
			setPosition(newPos + delay);
		}
	});

	const lyricWithEmptyLines = useMemo(
		() =>
			[emptyLine, emptyLine, ...processPauseLines(lyrics)].map((line, i) => ({
				...line,
				lineNumber: i,
			})),
		[lyrics],
	);

	const lyricsId = lyrics[0].text;

	let activeLineIndex = 0;
	for (let i = lyricWithEmptyLines.length - 1; i > 0; i--) {
		if (position >= lyricWithEmptyLines[i].startTime) {
			// If this is a pause line and the next one starts at the same time and is NOT a pause line,
			// prefer the next line (the text).
			if (
				isPauseLine(lyricWithEmptyLines[i].text) &&
				lyricWithEmptyLines[i + 1] &&
				position >= lyricWithEmptyLines[i + 1].startTime &&
				!isPauseLine(lyricWithEmptyLines[i + 1].text)
			) {
				continue;
			}
			activeLineIndex = i;
			break;
		}
	}

	const { activeLines, activeElementIndex } = useMemo(() => {
		let startIndex = activeLineIndex;
		let visibleBefore = 0;
		const targetBefore = Number(CONFIG.visual["lines-before"]) + 1;
		while (startIndex > 0 && visibleBefore < targetBefore) {
			startIndex--;
			if (!isPauseLine(lyricWithEmptyLines[startIndex].text)) {
				visibleBefore++;
			}
		}

		let endIndex = activeLineIndex;
		let visibleAfter = 0;
		const targetAfter = Number(CONFIG.visual["lines-after"]) + 1;
		while (endIndex < lyricWithEmptyLines.length - 1 && visibleAfter < targetAfter) {
			endIndex++;
			if (!isPauseLine(lyricWithEmptyLines[endIndex].text)) {
				visibleAfter++;
			}
		}

		return {
			activeLines: lyricWithEmptyLines.slice(startIndex, endIndex + 1),
			activeElementIndex: activeLineIndex - startIndex,
		};
	}, [activeLineIndex, lyricWithEmptyLines, CONFIG.visual["lines-before"], CONFIG.visual["lines-after"]]);

	let offset = lyricContainerEle.current ? lyricContainerEle.current.clientHeight / 2 : 0;
	if (activeLineEle.current) {
		offset += -(activeLineEle.current.offsetTop + activeLineEle.current.clientHeight / 2);
	}
	const adjustedAnimationIndices = [];
	let currentIndex = 0;
	for (let j = activeElementIndex; j < activeLines.length; j++) {
		adjustedAnimationIndices[j] = currentIndex;
		if (!isPauseLine(activeLines[j].text) || j === activeElementIndex) {
			currentIndex++;
		}
	}
	currentIndex = -1;
	for (let j = activeElementIndex - 1; j >= 0; j--) {
		adjustedAnimationIndices[j] = currentIndex;
		if (!isPauseLine(activeLines[j].text)) {
			currentIndex--;
		}
	}

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-SyncedLyricsPage",
			ref: lyricContainerEle,
		},
		react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-SyncedLyrics",
				style: {
					"--offset": `${offset}px`,
				},
				key: lyricsId,
			},
			activeLines.map(({ text, lineNumber, startTime, endTime, originalText, performer }, i) => {
				const isFocusedLine = activeElementIndex === i;
				const isPause = isPauseLine(text);

				// Calculate indicator state for pause lines
				const indicatorEl = getPauseIndicator(
					lyricWithEmptyLines,
					lineNumber,
					startTime,
					position,
					isFocusedLine,
					isPause,
				);

				let className = "lyrics-lyricsContainer-LyricsLine";
				let ref;

				const isPlaying = startTime != null && endTime != null && position >= startTime && position <= endTime;
				const isActive = isFocusedLine || isPlaying;

				if (isFocusedLine) {
					ref = activeLineEle;
				}
				if (isActive) {
					className += " lyrics-lyricsContainer-LyricsLine-active";
				} else if (isPause && !indicatorEl) {
					className += " lyrics-lyricsContainer-LyricsLine-hidden";
				}

				let animationIndex = adjustedAnimationIndices[i];

				const paddingLine =
					(animationIndex < 0 && -animationIndex > Number(CONFIG.visual["lines-before"])) ||
					animationIndex > Number(CONFIG.visual["lines-after"]);
				if (paddingLine) {
					className += " lyrics-lyricsContainer-LyricsLine-paddingLine";
				}
				const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
				// If we have original text and we are showing translated below, we should show the original text
				// Otherwise we should show the translated text
				const lineText = originalText && showTranslatedBelow ? originalText : text;

				// Convert lyrics to text for comparison
				const belowOrigin = (
					typeof originalText === "object" ? originalText?.props?.children?.[0] : originalText
				)?.replace(/\s+/g, "");
				const belowTxt =
					typeof text === "string"
						? text.replace(/\s+/g, "")
						: typeof text?.props?.children?.[0] === "string"
							? text.props.children[0].replace(/\s+/g, "")
							: "";

				const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;

				return react.createElement(
					"div",
					{
						className,
						style: {
							cursor: "pointer",
							"--position-index": animationIndex,
							"--animation-index": (animationIndex < 0 ? 0 : animationIndex) + 1,
							"--blur-index": Math.abs(animationIndex),
						},
						dir: "auto",
						ref,
						key: lineNumber,
						onClick: () => {
							if (startTime) {
								Spicetify.Player.seek(startTime);
							}
						},
					},
					isPause
						? indicatorEl
						: react.createElement(
								"p",
								{
									onContextMenu: (event) => {
										event.preventDefault();
										Spicetify.Platform.ClipboardAPI.copy(
											Utils.convertParsedToLRC(lyrics, belowMode).original,
										)
											.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
											.catch(() =>
												Spicetify.showNotification("Failed to copy lyrics to clipboard"),
											);
									},
								},
								renderPerformer(
									performer,
									lyricWithEmptyLines[lineNumber - 1]?.performer,
									CONFIG.visual["synced-compact"],
								),
								!isKara
									? lineText
									: react.createElement(KaraokeLine, {
											text,
											startTime,
											endTime,
											position,
											isActive,
										}),
							),
					belowMode &&
						react.createElement(
							"p",
							{
								style: {
									opacity: 0.5,
								},
								onContextMenu: (event) => {
									event.preventDefault();
									Spicetify.Platform.ClipboardAPI.copy(
										Utils.convertParsedToLRC(lyrics, belowMode).conver,
									)
										.then(() => Spicetify.showNotification("Translated lyrics copied to clipboard"))
										.catch(() =>
											Spicetify.showNotification("Failed to copy translated lyrics to clipboard"),
										);
								},
							},
							text,
						),
				);
			}),
		),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
	);
});

class SearchBar extends react.Component {
	constructor() {
		super();
		this.state = {
			hidden: true,
			atNode: 0,
			foundNodes: [],
		};
		this.container = null;
	}

	componentDidMount() {
		this.viewPort = document.querySelector(".main-view-container .os-viewport");
		this.mainViewOffsetTop = document.querySelector(".Root__main-view").offsetTop;
		this.toggleCallback = () => {
			if (!(Spicetify.Platform.History.location.pathname === "/lyrics-plus" && this.container)) return;

			if (this.state.hidden) {
				this.setState({ hidden: false });
				this.container.focus();
			} else {
				this.setState({ hidden: true });
				this.container.blur();
			}
		};
		this.unFocusCallback = () => {
			this.container.blur();
			this.setState({ hidden: true });
		};
		this.loopThroughCallback = (event) => {
			if (!this.state.foundNodes.length) {
				return;
			}

			if (event.key === "Enter") {
				const dir = event.shiftKey ? -1 : 1;
				let atNode = this.state.atNode + dir;
				if (atNode < 0) {
					atNode = this.state.foundNodes.length - 1;
				}
				atNode %= this.state.foundNodes.length;
				const rects = this.state.foundNodes[atNode].getBoundingClientRect();
				this.viewPort.scrollBy(0, rects.y - 100);
				this.setState({ atNode });
			}
		};

		Spicetify.Mousetrap().bind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).bind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).bind("enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).bind("shift+enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).bind("esc", this.unFocusCallback);
	}

	componentWillUnmount() {
		Spicetify.Mousetrap().unbind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).unbind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).unbind("enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).unbind("shift+enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).unbind("esc", this.unFocusCallback);
	}

	getNodeFromInput(event) {
		const value = event.target.value.toLowerCase();
		if (!value) {
			this.setState({ foundNodes: [] });
			this.viewPort.scrollTo(0, 0);
			return;
		}

		const lyricsPage = document.querySelector(".lyrics-lyricsContainer-UnsyncedLyricsPage");
		const walker = document.createTreeWalker(
			lyricsPage,
			NodeFilter.SHOW_TEXT,
			(node) => {
				if (node.textContent.toLowerCase().includes(value)) {
					return NodeFilter.FILTER_ACCEPT;
				}
				return NodeFilter.FILTER_REJECT;
			},
			false,
		);

		const foundNodes = [];
		while (walker.nextNode()) {
			const range = document.createRange();
			range.selectNodeContents(walker.currentNode);
			foundNodes.push(range);
		}

		if (!foundNodes.length) {
			this.viewPort.scrollBy(0, 0);
		} else {
			const rects = foundNodes[0].getBoundingClientRect();
			this.viewPort.scrollBy(0, rects.y - 100);
		}

		this.setState({ foundNodes, atNode: 0 });
	}

	render() {
		let y = 0;
		let height = 0;
		if (this.state.foundNodes.length) {
			const node = this.state.foundNodes[this.state.atNode];
			const rects = node.getBoundingClientRect();
			y = rects.y + this.viewPort.scrollTop - this.mainViewOffsetTop;
			height = rects.height;
		}
		return react.createElement(
			"div",
			{
				className: `lyrics-Searchbar${this.state.hidden ? " hidden" : ""}`,
			},
			react.createElement("input", {
				ref: (c) => {
					this.container = c;
				},
				onChange: this.getNodeFromInput.bind(this),
			}),
			react.createElement("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "currentColor",
				dangerouslySetInnerHTML: {
					__html: Spicetify.SVGIcons.search,
				},
			}),
			react.createElement(
				"span",
				{
					hidden: this.state.foundNodes.length === 0,
				},
				`${this.state.atNode + 1}/${this.state.foundNodes.length}`,
			),
			react.createElement("div", {
				className: "lyrics-Searchbar-highlight",
				style: {
					"--search-highlight-top": `${y}px`,
					"--search-highlight-height": `${height}px`,
				},
			}),
		);
	}
}

function isInViewport(element) {
	const rect = element.getBoundingClientRect();
	return (
		rect.top >= 0 &&
		rect.left >= 0 &&
		rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
		rect.right <= (window.innerWidth || document.documentElement.clientWidth)
	);
}

const SyncedExpandedLyricsPage = react.memo(({ lyrics, provider, copyright, isKara }) => {
	const [position, setPosition] = useState(
		() => Spicetify.Player.getProgress() + CONFIG.visual["global-delay"] + CONFIG.visual.delay,
	);
	const activeLineRef = useRef(null);
	const pageRef = useRef(null);

	useTrackPosition(() => {
		if (!Spicetify.Player.data.is_paused) {
			setPosition(Spicetify.Player.getProgress() + CONFIG.visual["global-delay"] + CONFIG.visual.delay);
		}
	});

	const padded = useMemo(() => [emptyLine, ...processPauseLines(lyrics)], [lyrics]);

	const initialScroll = useRef(true);

	// Reset scroll state when lyrics change
	useEffect(() => {
		initialScroll.current = true;
	}, [lyrics]);

	const lyricsId = lyrics[0].text;

	let activeLineIndex = 0;
	for (let i = padded.length - 1; i >= 0; i--) {
		const line = padded[i];
		if (position >= line.startTime) {
			// If this is a pause line and the next one starts at the same time and is NOT a pause line,
			// prefer the next line (the text).
			if (
				isPauseLine(line.text) &&
				padded[i + 1] &&
				position >= padded[i + 1].startTime &&
				!isPauseLine(padded[i + 1].text)
			) {
				continue;
			}
			activeLineIndex = i;
			break;
		}
	}

	useEffect(() => {
		if (activeLineRef.current && (initialScroll.current || isInViewport(activeLineRef.current))) {
			// Ignore focus on the first "empty" idling indicator if it's during initial load
			if (initialScroll.current && activeLineIndex === 0) {
				const nextStart = findNextLineStartTime(padded, 0);
				// If the intro is very short (e.g. less than 300ms), don't focus it
				if (nextStart && nextStart - position < 300) {
					initialScroll.current = false;
					return;
				}
			}

			activeLineRef.current.scrollIntoView({
				behavior: initialScroll.current ? "auto" : "smooth",
				block: "center",
				inline: "nearest",
			});
			initialScroll.current = false;
		}
	}, [activeLineIndex, lyricsId]);

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
			key: lyricsId,
			ref: pageRef,
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		padded.map(({ text, startTime, endTime, originalText, performer }, i) => {
			// Show idling indicator for the initial empty line
			if (i === 0) {
				const nextStart = findNextLineStartTime(padded, 0);
				return react.createElement(IdlingIndicator, {
					key: i,
					isActive: activeLineIndex === 0,
					progress: nextStart ? position / nextStart : 0,
					delay: nextStart ? nextStart / 3 : 0,
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					style: { "--position-index": 0, "--animation-index": 1 },
				});
			}

			const isFocused = i === activeLineIndex;
			const isPause = isPauseLine(text);

			// Calculate indicator state for pause lines
			const indicatorEl = getPauseIndicator(padded, i, startTime, position, isFocused, isPause);

			const isPlaying = startTime != null && endTime != null && position >= startTime && position <= endTime;
			const isPast =
				(endTime != null && position > endTime) || (!isFocused && startTime != null && position > startTime);
			const isActive = isFocused || isPlaying;

			let className = `lyrics-lyricsContainer-LyricsLine${isActive ? " lyrics-lyricsContainer-LyricsLine-active" : ""}${isPast ? " lyrics-lyricsContainer-LyricsLine-past" : ""}`;
			if (isPause && !indicatorEl) {
				className += " lyrics-lyricsContainer-LyricsLine-hidden";
			}

			const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
			// If we have original text and we are showing translated below, we should show the original text
			// Otherwise we should show the translated text
			const lineText = originalText && showTranslatedBelow ? originalText : text;

			// Convert lyrics to text for comparison
			const belowOrigin = (
				typeof originalText === "object" ? originalText?.props?.children?.[0] : originalText
			)?.replace(/\s+/g, "");
			const belowTxt =
				typeof text === "string"
					? text.replace(/\s+/g, "")
					: typeof text?.props?.children?.[0] === "string"
						? text.props.children[0].replace(/\s+/g, "")
						: "";

			const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;

			return react.createElement(
				"div",
				{
					className,
					key: i,
					style: {
						cursor: "pointer",
					},
					dir: "auto",
					ref: isFocused ? activeLineRef : null,
					onClick: () => {
						if (startTime) {
							Spicetify.Player.seek(startTime);
						}
					},
				},
				isPause
					? indicatorEl
					: react.createElement(
							"p",
							{
								onContextMenu: (event) => {
									event.preventDefault();
									Spicetify.Platform.ClipboardAPI.copy(
										Utils.convertParsedToLRC(lyrics, belowMode).original,
									)
										.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
										.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
								},
							},
							renderPerformer(performer, padded[i - 1]?.performer, CONFIG.visual["synced-compact"]),
							!isKara
								? lineText
								: react.createElement(KaraokeLine, { text, startTime, endTime, position, isActive }),
						),
				belowMode &&
					react.createElement(
						"p",
						{
							style: { opacity: 0.5 },
							onContextMenu: (event) => {
								event.preventDefault();
								Spicetify.Platform.ClipboardAPI.copy(Utils.convertParsedToLRC(lyrics, belowMode).conver)
									.then(() => Spicetify.showNotification("Translated lyrics copied to clipboard"))
									.catch(() =>
										Spicetify.showNotification("Failed to copy translated lyrics to clipboard"),
									);
							},
						},
						text,
					),
			);
		}),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
		react.createElement(SearchBar, null),
	);
});

const UnsyncedLyricsPage = react.memo(({ lyrics, provider, copyright }) => {
	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		lyrics.map(({ text, originalText, performer }, index) => {
			const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
			// If we have original text and we are showing translated below, we should show the original text
			// Otherwise we should show the translated text
			const lineText = originalText && showTranslatedBelow ? originalText : text;

			// Convert lyrics to text for comparison
			const belowOrigin = (
				typeof originalText === "object" ? originalText?.props?.children?.[0] : originalText
			)?.replace(/\s+/g, "");
			const belowTxt =
				typeof text === "string"
					? text.replace(/\s+/g, "")
					: typeof text?.props?.children?.[0] === "string"
						? text.props.children[0].replace(/\s+/g, "")
						: "";

			const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;

			return react.createElement(
				"div",
				{
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					key: index,
					dir: "auto",
				},
				react.createElement(
					"p",
					{
						onContextMenu: (event) => {
							event.preventDefault();
							Spicetify.Platform.ClipboardAPI.copy(
								Utils.convertParsedToUnsynced(lyrics, belowMode).original,
							)
								.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
								.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
						},
					},
					renderPerformer(performer, lyrics[index - 1]?.performer, false),
					lineText,
				),
				belowMode &&
					react.createElement(
						"p",
						{
							style: { opacity: 0.5 },
							onContextMenu: (event) => {
								event.preventDefault();
								Spicetify.Platform.ClipboardAPI.copy(
									Utils.convertParsedToUnsynced(lyrics, belowMode).conver,
								)
									.then(() => Spicetify.showNotification("Translated lyrics copied to clipboard"))
									.catch(() =>
										Spicetify.showNotification("Failed to copy translated lyrics to clipboard"),
									);
							},
						},
						text,
					),
			);
		}),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
		react.createElement(SearchBar, null),
	);
});

const noteContainer = document.createElement("div");
noteContainer.classList.add("lyrics-Genius-noteContainer");
const noteDivider = document.createElement("div");
noteDivider.classList.add("lyrics-Genius-divider");
noteDivider.innerHTML = `<svg width="32" height="32" viewBox="0 0 13 4" fill="currentColor"><path d="M13 10L8 4.206 3 10z"/></svg>`;
noteDivider.style.setProperty("--link-left", 0);
const noteTextContainer = document.createElement("div");
noteTextContainer.classList.add("lyrics-Genius-noteTextContainer");
noteTextContainer.onclick = (event) => {
	event.preventDefault();
	event.stopPropagation();
};
noteContainer.append(noteDivider, noteTextContainer);

function showNote(parent, note) {
	if (noteContainer.parentElement === parent) {
		noteContainer.remove();
		return;
	}
	noteTextContainer.innerText = note;
	parent.append(noteContainer);
	const arrowPos = parent.offsetLeft - noteContainer.offsetLeft;
	noteDivider.style.setProperty("--link-left", `${arrowPos}px`);
	const box = noteTextContainer.getBoundingClientRect();
	if (box.y + box.height > window.innerHeight) {
		// Wait for noteContainer is mounted
		setTimeout(() => {
			noteContainer.scrollIntoView({
				behavior: "smooth",
				block: "center",
				inline: "nearest",
			});
		}, 50);
	}
}

const GeniusPage = react.memo(
	({
		lyrics,
		provider,
		copyright,
		versions,
		versionIndex,
		onVersionChange,
		isSplitted,
		lyrics2,
		versionIndex2,
		onVersionChange2,
	}) => {
		let notes = {};
		let container = null;
		let container2 = null;

		// Fetch notes
		useEffect(() => {
			if (!container) return;
			notes = {};
			let links = container.querySelectorAll("a");
			if (isSplitted && container2) {
				links = [...links, ...container2.querySelectorAll("a")];
			}
			for (const link of links) {
				let id = link.pathname.match(/\/(\d+)\//);
				if (!id) {
					id = link.dataset.id;
				} else {
					id = id[1];
				}
				ProviderGenius.getNote(id).then((note) => {
					notes[id] = note;
					link.classList.add("fetched");
				});
				link.onclick = (event) => {
					event.preventDefault();
					if (!notes[id]) return;
					showNote(link, notes[id]);
				};
			}
		}, [lyrics, lyrics2]);

		const lyricsEl1 = react.createElement(
			"div",
			null,
			react.createElement(VersionSelector, { items: versions, index: versionIndex, callback: onVersionChange }),
			react.createElement("div", {
				className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
				ref: (c) => {
					container = c;
				},
				dangerouslySetInnerHTML: {
					__html: lyrics,
				},
				onContextMenu: (event) => {
					event.preventDefault();
					const copylyrics = lyrics.replace(/<br>/g, "\n").replace(/<[^>]*>/g, "");
					Spicetify.Platform.ClipboardAPI.copy(copylyrics)
						.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
						.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
				},
			}),
		);

		const mainContainer = [lyricsEl1];
		const shouldSplit = versions.length > 1 && isSplitted;

		if (shouldSplit) {
			const lyricsEl2 = react.createElement(
				"div",
				null,
				react.createElement(VersionSelector, {
					items: versions,
					index: versionIndex2,
					callback: onVersionChange2,
				}),
				react.createElement("div", {
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					ref: (c) => {
						container2 = c;
					},
					dangerouslySetInnerHTML: {
						__html: lyrics2,
					},
					onContextMenu: (event) => {
						event.preventDefault();
						const copylyrics = lyrics.replace(/<br>/g, "\n").replace(/<[^>]*>/g, "");
						Spicetify.Platform.ClipboardAPI.copy(copylyrics)
							.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
							.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
					},
				}),
			);
			mainContainer.push(lyricsEl2);
		}

		return react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
			},
			react.createElement("p", {
				className: "lyrics-lyricsContainer-LyricsUnsyncedPadding main-type-ballad",
			}),
			react.createElement("div", { className: shouldSplit ? "split" : "" }, mainContainer),
			react.createElement(CreditFooter, {
				provider,
				copyright,
			}),
			react.createElement(SearchBar, null),
		);
	},
);

const LoadingIcon = react.createElement(
	"svg",
	{
		width: "200px",
		height: "200px",
		viewBox: "0 0 100 100",
		preserveAspectRatio: "xMidYMid",
	},
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "0s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "0s",
		}),
	),
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		}),
	),
);

const VersionSelector = react.memo(({ items, index, callback }) => {
	if (items.length < 2) {
		return null;
	}
	return react.createElement(
		"div",
		{
			className: "lyrics-versionSelector",
		},
		react.createElement(
			"select",
			{
				onChange: (event) => {
					callback(items, event.target.value);
				},
				value: index,
			},
			items.map((a, i) => {
				return react.createElement("option", { value: i }, a.title);
			}),
		),
		react.createElement(
			"svg",
			{
				height: "16",
				width: "16",
				fill: "currentColor",
				viewBox: "0 0 16 16",
			},
			react.createElement("path", {
				d: "M3 6l5 5.794L13 6z",
			}),
		),
	);
});

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
				const { fetchExtractedColorForTrackEntity } = Spicetify.GraphQL.Definitions;
				const { data } = await Spicetify.GraphQL.Request(fetchExtractedColorForTrackEntity, { uri });
				const { hex } = data.trackUnion.albumOfTrack.coverArt.extractedColors.colorDark;
				vibrant = Number.parseInt(hex.replace("#", ""), 16);
			} catch {
				const colors = await Spicetify.CosmosAsync.get(
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
		const audio = await Spicetify.CosmosAsync.get(
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

		Spicetify.showNotification(MUSIXMATCH_TRANSLATION_FETCH_MESSAGE, false, 1000);

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
				Spicetify.showNotification(MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE, true, 3000);
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
				Spicetify.showNotification(MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE, true, 3000);
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
			if (spotifyVersion >= "1.2.31" && id === "genius") continue;
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

		Spicetify.showNotification("Converting...", false, 1000);
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
					Spicetify.showNotification("No conversion is needed", false, 1000);
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
					Spicetify.showNotification("No conversion is needed", false, 1000);
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
			Spicetify.showNotification("Converting...", false, 0);
			return res;
		} catch (error) {
			Spicetify.showNotification("Convert Error!", true);
			console.error(error);
		}
	}

	resetDelay() {
		CONFIG.visual.delay = Number(localStorage.getItem(`lyrics-delay:${Spicetify.Player.data.item.uri}`)) || 0;
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
			Spicetify.showNotification("File too large", true);
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
					Spicetify.showNotification("Nothing to load", true);
					return;
				}

				this.setState({ ...localLyrics, provider: "local" });
				CACHE[this.currentTrackUri] = { ...localLyrics, provider: "local", uri: this.currentTrackUri };
				this.saveLocalLyrics(this.currentTrackUri, localLyrics);

				Spicetify.showNotification(`Loaded ${parsedKeys.join(", ")} lyrics from file`);
			} catch (e) {
				console.error(e);
				Spicetify.showNotification("Failed to load lyrics", true);
			}
		};

		reader.onerror = (e) => {
			console.error(e);
			Spicetify.showNotification("Failed to read file", true);
		};

		reader.readAsText(file[0]);
		event.target.value = "";
	}
	initMoustrap() {
		if (!this.mousetrap && Spicetify.Mousetrap) {
			this.mousetrap = new Spicetify.Mousetrap();
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

		if (Spicetify.Player?.data?.item) {
			this.state.explicitMode = this.state.lockMode;
			this.currentTrackUri = Spicetify.Player.data.item.uri;
			this.fetchLyrics(Spicetify.Player.data.item, this.state.explicitMode);
		}

		this.updateVisualOnConfigChange();
		Utils.addQueueListener(this.onQueueChange);

		lyricContainerUpdate = () => {
			this.reRenderLyricsPage = !this.reRenderLyricsPage;
			this.updateVisualOnConfigChange();
			this.forceUpdate();

			if (this.currentMusixmatchLanguage !== CONFIG.visual["musixmatch-translation-language"]) {
				this.currentMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"];
				this.refreshMusixmatchTranslation();
			}
		};

		reloadLyrics = () => {
			CACHE = {};
			this.updateVisualOnConfigChange();
			this.forceUpdate();
			this.fetchLyrics(Spicetify.Player.data.item, this.state.explicitMode, true);
		};

		this.viewPort =
			document.querySelector(".Root__main-view .os-viewport") ??
			document.querySelector(".Root__main-view .main-view-container__scroll-node");

		this.configButton = new Spicetify.Menu.Item("Lyrics Plus config", false, openConfig, "lyrics");
		this.configButton.register();

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
			lyricContainerUpdate();
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
		window.addEventListener("fad-request", lyricContainerUpdate);
	}

	componentWillUnmount() {
		Utils.removeQueueListener(this.onQueueChange);
		this.configButton.deregister();
		this.mousetrap.reset();
		window.removeEventListener("fad-request", lyricContainerUpdate);
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
					Spicetify.ReactComponent.TooltipWrapper,
					{
						label: this.state.isCached ? "Lyrics cached" : "Cache lyrics",
					},
					react.createElement(
						"button",
						{
							className: "lyrics-config-button",
							onClick: () => {
								const { synced, unsynced, karaoke, genius } = this.state;
								if (!synced && !unsynced && !karaoke && !genius) {
									Spicetify.showNotification("No lyrics to cache", true);
									return;
								}

								if (this.state.isCached) {
									this.deleteLocalLyrics(this.currentTrackUri);
									Spicetify.showNotification("Delete lyrics cache");
								} else {
									this.saveLocalLyrics(this.currentTrackUri, { synced, unsynced, karaoke, genius });
									Spicetify.showNotification("Lyrics cached");
								}
							},
						},
						react.createElement("svg", {
							width: 16,
							height: 16,
							viewBox: "0 0 16 16",
							fill: "currentColor",
							dangerouslySetInnerHTML: {
								__html: Spicetify.SVGIcons[this.state.isCached ? "downloaded" : "download"],
							},
						}),
					),
				),
				react.createElement(
					Spicetify.ReactComponent.TooltipWrapper,
					{
						label: "Load lyrics from file",
					},
					react.createElement(
						"button",
						{
							className: "lyrics-config-button",
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
								__html: Spicetify.SVGIcons["plus-alt"],
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
						const info = this.infoFromTrack(Spicetify.Player.data.item);
						if (info?.uri && CACHE[info?.uri]) {
							CACHE[info.uri].mode = mode;
						}

						this.setState({ explicitMode: mode });
						if (this.state.provider !== "local") this.fetchLyrics(Spicetify.Player.data.item, mode);
					}
				},
				lockCallback: (label) => {
					let mode = CONFIG.modes.findIndex((a) => a === label);
					if (mode === this.state.lockMode) {
						mode = -1;
					}
					this.setState({ explicitMode: mode, lockMode: mode });
					this.fetchLyrics(Spicetify.Player.data.item, mode);
					CONFIG.locked = mode;
					localStorage.setItem("lyrics-plus:lock-mode", mode);
				},
			}),
		);

		if (this.state.isFullscreen) return Spicetify.ReactDOM.createPortal(out, this.fullscreenContainer);
		if (fadLyricsContainer) return Spicetify.ReactDOM.createPortal(out, fadLyricsContainer);
		return out;
	}
}

// ============================================================================
// PlaybarButton.js (adapted) — classic IIFE turned into a ctx-scoped function
// ============================================================================

function initPlaybarButton(ctx: ModuleRuntimeContext) {
	if (!Spicetify.Platform?.History) {
		const retry = window.setTimeout(() => initPlaybarButton(ctx), 300);
		ctx.defer(() => window.clearTimeout(retry));
		return;
	}

	const button = new Spicetify.Playbar.Button(
		"Lyrics Plus",
		`<svg role="img" height="16" width="16" aria-hidden="true" viewBox="0 0 16 16" data-encore-id="icon" fill="currentColor"><path d="M13.426 2.574a2.831 2.831 0 0 0-4.797 1.55l3.247 3.247a2.831 2.831 0 0 0 1.55-4.797zM10.5 8.118l-2.619-2.62A63303.13 63303.13 0 0 0 4.74 9.075L2.065 12.12a1.287 1.287 0 0 0 1.816 1.816l3.06-2.688 3.56-3.129zM7.12 4.094a4.331 4.331 0 1 1 4.786 4.786l-3.974 3.493-3.06 2.689a2.787 2.787 0 0 1-3.933-3.933l2.676-3.045 3.505-3.99z"></path></svg>`,
		() =>
			Spicetify.Platform.History.location.pathname !== "/lyrics-plus"
				? Spicetify.Platform.History.push("/lyrics-plus")
				: Spicetify.Platform.History.goBack(),
		false,
		Spicetify.Platform.History.location.pathname === "/lyrics-plus",
		false,
	);

	const style = document.createElement("style");
	style.innerHTML = `
		.main-nowPlayingBar-lyricsButton[data-testid="lyrics-button"] {
			display: none !important;
		}
		li[data-id="/lyrics-plus"] {
			display: none;
		}
	`;
	style.classList.add("lyrics-plus:visual:playbar-button");

	let registered = false;
	const setPlaybarButton = () => {
		if (registered) return;
		document.head.appendChild(style);
		button.register();
		registered = true;
	};
	const removePlaybarButton = () => {
		if (!registered) return;
		style.remove();
		button.deregister();
		registered = false;
	};

	if (Spicetify.LocalStorage.get("lyrics-plus:visual:playbar-button") === "true") setPlaybarButton();

	const onToggle = (event: any) => {
		if (event.detail?.name === "playbar-button") {
			if (event.detail.value) setPlaybarButton();
			else removePlaybarButton();
		}
	};
	window.addEventListener("lyrics-plus", onToggle);

	const unlisten = Spicetify.Platform.History.listen((location: any) => {
		button.active = location.pathname === "/lyrics-plus";
	});

	ctx.defer(() => {
		removePlaybarButton();
		window.removeEventListener("lyrics-plus", onToggle);
		if (typeof unlisten === "function") unlisten();
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
	initPlaybarButton(ctx);
}
