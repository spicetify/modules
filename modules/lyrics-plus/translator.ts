/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CONFIG } from "./config.ts";

interface JapaneseTranslator {
	init(analyzer: unknown): Promise<void>;
	convert(text: string, options: { to: string; mode: string }): Promise<string>;
}

declare const Kuroshiro: { default: new () => JapaneseTranslator };
declare const KuromojiAnalyzer: new (options: { dictPath: string }) => unknown;
declare const Aromanize: { hangulToLatin(text: string, mode: string): string };
declare const OpenCC: { Converter(options: { from: string; to: string }): (text: string) => string };

declare global {
	interface XMLHttpRequest {
		realOpen?: XMLHttpRequest["open"];
	}
}

const kuroshiroPath = "https://cdn.jsdelivr.net/npm/kuroshiro@1.2.0/dist/kuroshiro.min.js";
const kuromojiPath =
	"https://cdn.jsdelivr.net/npm/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js";
const aromanize = "https://cdn.jsdelivr.net/npm/aromanize@0.1.5/aromanize.min.js";
const openCCPath = "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.min.js";

const dictPath = "https:/cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict";

export class Translator {
	private readonly finished = { ja: false, ko: false, zh: false };
	private readonly isUsingNetease: boolean;
	private kuroshiro?: JapaneseTranslator;
	private Aromanize?: typeof Aromanize;
	private OpenCC?: typeof OpenCC;
	constructor(lang: string, isUsingNetease = false) {
		this.isUsingNetease = isUsingNetease;

		this.applyKuromojiFix();
		this.injectExternals(lang);
		this.createTranslator(lang);
	}

	includeExternal(url: string) {
		if ((CONFIG.visual.translate || this.isUsingNetease) && !document.querySelector(`script[src="${url}"]`)) {
			const script = document.createElement("script");
			script.setAttribute("type", "text/javascript");
			script.setAttribute("src", url);
			document.head.appendChild(script);
		}
	}

	injectExternals(lang: string) {
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

	async awaitFinished(language: string): Promise<void> {
		return new Promise<void>((resolve) => {
			const interval = setInterval(() => {
				this.injectExternals(language);
				this.createTranslator(language);

				const lan = language.slice(0, 2);
				if ((lan === "ja" || lan === "ko" || lan === "zh") && this.finished[lan]) {
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
		const originalOpen = XMLHttpRequest.prototype.open;
		XMLHttpRequest.prototype.realOpen = originalOpen;
		XMLHttpRequest.prototype.open = function (
			this: XMLHttpRequest,
			method: string,
			url: string | URL,
			async: boolean = true,
			username?: string | null,
			password?: string | null,
		) {
			const resolvedURL = String(url);
			const target = resolvedURL.startsWith(dictPath.replace("https://", "https:/"))
				? resolvedURL.replace("https:/", "https://")
				: url;
			originalOpen.call(this, method, target, async, username, password);
		};
	}

	async createTranslator(lang: string): Promise<void> {
		switch (lang.slice(0, 2)) {
			case "ja":
				if (this.kuroshiro) return;
				if (typeof Kuroshiro === "undefined" || typeof KuromojiAnalyzer === "undefined") {
					await Translator.#sleep(50);
					return this.createTranslator(lang);
				}

				this.kuroshiro = new Kuroshiro.default();
				this.kuroshiro.init(new KuromojiAnalyzer({ dictPath })).then(() => {
					this.finished.ja = true;
				});

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

	async romajifyText(text: string, target = "romaji", mode = "spaced"): Promise<string> {
		if (!this.finished.ja || !this.kuroshiro) {
			await Translator.#sleep(100);
			return this.romajifyText(text, target, mode);
		}

		return this.kuroshiro.convert(text, {
			to: target,
			mode: mode,
		});
	}

	async convertToRomaja(text: string, target: string): Promise<string> {
		if (!this.finished.ko) {
			await Translator.#sleep(100);
			return this.convertToRomaja(text, target);
		}

		if (target === "hangul") return text;
		return Aromanize.hangulToLatin(text, "rr-translit");
	}

	async convertChinese(text: string, from: string, target: string): Promise<string> {
		if (!this.finished.zh || !this.OpenCC) {
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
	static async #sleep(ms: number): Promise<void> {
		return new Promise<void>((resolve) => setTimeout(resolve, ms));
	}
}
