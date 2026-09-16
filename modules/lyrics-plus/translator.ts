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

type Language = "ja" | "ko" | "zh";

export interface TranslatorOptions {
	timeoutMs?: number;
}

export class Translator {
	private readonly loading = new Map<Language, Promise<void>>();
	private readonly lifecycle = new AbortController();
	private readonly timeoutMs: number;
	private readonly isUsingNetease: boolean;
	private kuroshiro?: JapaneseTranslator;
	private Aromanize?: typeof Aromanize;
	private OpenCC?: typeof OpenCC;

	constructor(lang: string, isUsingNetease = false, options: TranslatorOptions = {}) {
		this.isUsingNetease = isUsingNetease;
		this.timeoutMs = options.timeoutMs ?? 15_000;
		this.applyKuromojiFix();
		// Eager loading has no caller to receive errors; explicit requests retry failures.
		void this.awaitFinished(lang).catch(() => {});
	}

	dispose(): void {
		this.lifecycle.abort(new DOMException("Translator disposed", "AbortError"));
		this.kuroshiro = undefined;
		this.Aromanize = undefined;
		this.OpenCC = undefined;
	}

	private bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.lifecycle.signal.aborted) return Promise.reject(this.lifecycle.signal.reason);
		const controller = new AbortController();
		const dispose = () => controller.abort(this.lifecycle.signal.reason);
		this.lifecycle.signal.addEventListener("abort", dispose, { once: true });
		const timer = setTimeout(
			() => controller.abort(new Error("Translator loading or conversion timed out")),
			this.timeoutMs,
		);
		return new Promise<T>((resolve, reject) => {
			const abort = () => reject(controller.signal.reason);
			controller.signal.addEventListener("abort", abort, { once: true });
			operation(controller.signal)
				.then(resolve, reject)
				.finally(() => {
					controller.signal.removeEventListener("abort", abort);
				});
		}).finally(() => {
			controller.abort();
			clearTimeout(timer);
			this.lifecycle.signal.removeEventListener("abort", dispose);
		});
	}

	private loadScript(url: string, signal: AbortSignal, isReady: () => boolean): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (signal.aborted) return reject(signal.reason);
			const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
			const script = existing ?? document.createElement("script");
			const cleanup = () => {
				script.removeEventListener("load", loaded);
				script.removeEventListener("error", failed);
				signal.removeEventListener("abort", aborted);
			};
			const loaded = () => {
				if (!isReady()) return fail(new Error(`Translator did not load: ${url}`));
				cleanup();
				resolve();
			};
			const fail = (reason: unknown) => {
				cleanup();
				script.remove();
				reject(reason);
			};
			const failed = () => fail(new Error(`Failed to load translator: ${url}`));
			const aborted = () => fail(signal.reason);
			script.addEventListener("load", loaded, { once: true });
			script.addEventListener("error", failed, { once: true });
			signal.addEventListener("abort", aborted, { once: true });
			if (!existing) {
				script.type = "text/javascript";
				script.src = url;
				document.head.appendChild(script);
			}
		});
	}

	async awaitFinished(language: string): Promise<void> {
		if (this.lifecycle.signal.aborted) throw this.lifecycle.signal.reason;
		const lang = language.slice(0, 2);
		if (lang !== "ja" && lang !== "ko" && lang !== "zh")
			throw new Error(`Unsupported translator language: ${language}`);
		if ((lang === "ja" && this.kuroshiro) || (lang === "ko" && this.Aromanize) || (lang === "zh" && this.OpenCC))
			return;
		const pending = this.loading.get(lang);
		if (pending) return pending;
		if (!CONFIG.visual.translate && !this.isUsingNetease) throw new Error("Translation is disabled");
		const loading = this.bounded((signal) => this.initialize(lang, signal)).finally(() =>
			this.loading.delete(lang),
		);
		this.loading.set(lang, loading);
		return loading;
	}

	private async initialize(lang: Language, signal: AbortSignal): Promise<void> {
		switch (lang) {
			case "ja": {
				await Promise.all([
					typeof KuromojiAnalyzer === "undefined"
						? this.loadScript(kuromojiPath, signal, () => typeof KuromojiAnalyzer !== "undefined")
						: Promise.resolve(),
					typeof Kuroshiro === "undefined"
						? this.loadScript(kuroshiroPath, signal, () => typeof Kuroshiro !== "undefined")
						: Promise.resolve(),
				]);
				signal.throwIfAborted();
				if (typeof Kuroshiro === "undefined" || typeof KuromojiAnalyzer === "undefined")
					throw new Error("Japanese translator did not load");
				const translator = new Kuroshiro.default();
				await translator.init(new KuromojiAnalyzer({ dictPath }));
				signal.throwIfAborted();
				this.kuroshiro = translator;
				break;
			}
			case "ko":
				if (typeof Aromanize === "undefined")
					await this.loadScript(aromanize, signal, () => typeof Aromanize !== "undefined");
				signal.throwIfAborted();
				if (typeof Aromanize === "undefined") throw new Error("Korean translator did not load");
				this.Aromanize = Aromanize;
				break;
			case "zh":
				if (typeof OpenCC === "undefined")
					await this.loadScript(openCCPath, signal, () => typeof OpenCC !== "undefined");
				signal.throwIfAborted();
				if (typeof OpenCC === "undefined") throw new Error("Chinese translator did not load");
				this.OpenCC = OpenCC;
				break;
		}
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

	async romajifyText(text: string, target = "romaji", mode = "spaced"): Promise<string> {
		await this.awaitFinished("ja");
		if (!this.kuroshiro) throw this.lifecycle.signal.reason;
		const translator = this.kuroshiro;
		return this.bounded(() => translator.convert(text, { to: target, mode }));
	}

	async convertToRomaja(text: string, target: string): Promise<string> {
		await this.awaitFinished("ko");
		if (!this.Aromanize) throw this.lifecycle.signal.reason;
		return target === "hangul" ? text : this.Aromanize.hangulToLatin(text, "rr-translit");
	}

	async convertChinese(text: string, from: string, target: string): Promise<string> {
		await this.awaitFinished("zh");
		if (!this.OpenCC) throw this.lifecycle.signal.reason;
		return this.OpenCC.Converter({ from, to: target })(text);
	}
}
