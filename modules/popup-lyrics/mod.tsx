/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Popup Lyrics" extension by
 * khanhas (Netease parser + UI from github.com/mantou132/Spotify-Lyrics). It
 * renders synced lyrics onto a canvas that is streamed into a picture-in-picture
 * window and toggled from a topbar button.
 *
 * v3 adaptations, everything else is kept near-verbatim:
 *   - The classic build loaded its own file twice (main + Web Worker) and
 *     branched on navigator.serviceWorker. A bundled module cannot re-load its
 *     own path, so the "keep ticking while the window is hidden" worker is now
 *     an inline Blob worker (CSP-permitted in the client).
 *   - The topbar button goes through registrar.placeButton("topbar-right"), so
 *     it sits with the other module topbar buttons.
 *   - Preferences render through the shared Spicetify Settings register.
 *   - The injected <style> tag moved into index.scss.
 *   - All teardown routes through ctx.defer.
 *   - CosmosAsync still proxies both the authed Spotify color-lyrics endpoint
 *     and external provider hosts in v3, so the providers are unchanged; LRCLIB
 *     is CORS-enabled and keeps using plain fetch.
 */

import { client, createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import {
	Button,
	IconButton,
	Select,
	SettingsRow,
	SettingsSection,
	TextInput,
	Toggle,
} from "/modules/stdlib/lib/primitives.js";
import { SETTINGS_HELP_TEXT_CLASS } from "/modules/stdlib/lib/primitives-classes.js";

import {
	LyricUtils,
	parseLrclibBody,
	parseMusixmatchMacro,
	parseNeteaseLyrics,
	parseSpotifyLyrics,
	pickNeteaseTrack,
} from "./logic.ts";
import type { Lyric, LyricResult, TrackInfo } from "./logic.ts";

interface ParagraphOptions {
	left: number;
	right: number;
	lineHeight: number;
	hCenter?: boolean;
	vCenter?: boolean;
	top?: number;
	bottom?: number;
	translateX?: number | ((width: number) => number);
	translateY?: number | ((height: number) => number);
	measure?: boolean;
}

export default async function (ctx: ModuleRuntimeContext) {
	const { player: Player, cosmos: CosmosAsync, storage: LocalStorage } = client;
	if (!CosmosAsync || !LocalStorage) return;

	let CACHE: Record<string, LyricResult> = {};

	// ---- worker: keep ticking while the window is hidden ----
	// When the client is minimised, requestAnimationFrame stops and timers are
	// throttled to ~1s. A worker's setInterval stays on time, so it drives the
	// canvas repaint. Built from an inline Blob so the module needs no sidecar.
	const workerCode = `
		let num = null;
		onmessage = (event) => {
			if (event.data === "popup-lyric-request-update") {
				num = setInterval(() => postMessage("popup-lyric-update-ui"), 16.66);
			} else if (event.data === "popup-lyric-stop-update") {
				clearInterval(num);
				postMessage("popup-lyric-update-ui");
				num = null;
			}
		};`;
	let worker: Worker | null = null;
	let workerUrl: string | null = null;
	try {
		workerUrl = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
		worker = new Worker(workerUrl);
		worker.onmessage = (event) => {
			if (event.data === "popup-lyric-update-ui") tick(userConfigs);
		};
	} catch (_) {
		worker = null;
	}

	let workerIsRunning = false;
	const onVisibility = (e: Event) => {
		if ((e.target as Document).hidden) {
			if (!workerIsRunning) {
				worker?.postMessage("popup-lyric-request-update");
				workerIsRunning = true;
			}
		} else if (workerIsRunning) {
			worker?.postMessage("popup-lyric-stop-update");
			workerIsRunning = false;
		}
	};
	document.addEventListener("visibilitychange", onVisibility);

	// The bundled Musixmatch usertoken expires; when a request comes back 401 we
	// mint a fresh web-desktop token once and retry, so lyrics keep working without
	// the user opening settings to refresh it.
	let pendingTokenRefresh: Promise<string | null> | null = null;
	function refreshMusixmatchToken(): Promise<string | null> {
		if (!pendingTokenRefresh) {
			pendingTokenRefresh = (async () => {
				try {
					const { message } = await CosmosAsync.get(
						"https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0",
						null,
						{ authority: "apic-desktop.musixmatch.com", cookie: "x-mxm-token-guid=" },
					);
					const token = message?.body?.user_token;
					if (message?.header?.status_code === 200 && token && !token.startsWith("UpgradeOnly")) {
						userConfigs.services.musixmatch.token = token;
						LocalStorage.set("popup-lyrics:services:musixmatch:token", token);
						return token;
					}
				} catch (error) {
					console.error("Musixmatch token refresh failed", error);
				}
				return null;
			})().finally(() => {
				pendingTokenRefresh = null;
			});
		}
		return pendingTokenRefresh;
	}

	const LyricProviders = {
		async fetchSpotify(info: TrackInfo): Promise<LyricResult> {
			const baseURL = "https://spclient.wg.spotify.com/color-lyrics/v2/track/";
			const id = info.uri.split(":")[2];
			const body = await CosmosAsync.get(`${baseURL + id}?format=json&vocalRemoval=false&market=from_token`);
			return parseSpotifyLyrics(body);
		},

		async fetchMusixmatch(info: TrackInfo): Promise<LyricResult> {
			const baseURL =
				"https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&namespace=lyrics_synched&subtitle_format=mxm&app_id=web-desktop-app-v1.0&";

			const durr = info.duration / 1000;

			const params: Record<string, string | number> = {
				q_album: info.album,
				q_artist: info.artist,
				q_artists: info.artist,
				q_track: info.title,
				track_spotify_id: info.uri,
				q_duration: durr,
				f_subtitle_length: Math.floor(durr),
			};

			const requestHeaders = {
				authority: "apic-desktop.musixmatch.com",
				cookie: "x-mxm-token-guid=",
			};
			const buildURL = (token: string) =>
				baseURL +
				Object.entries({ ...params, usertoken: token })
					.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
					.join("&");

			try {
				let body = await CosmosAsync.get(buildURL(userConfigs.services.musixmatch.token), null, requestHeaders);

				if (body?.message?.header?.status_code === 401) {
					const token = await refreshMusixmatchToken();
					if (token) body = await CosmosAsync.get(buildURL(token), null, requestHeaders);
				}

				body = body.message.body.macro_calls;
				return parseMusixmatchMacro(body);
			} catch (err) {
				return { error: (err as Error).message };
			}
		},

		async fetchNetease(info: TrackInfo): Promise<LyricResult> {
			const searchURL = "https://music.xianqiao.wang/neteaseapiv2/search?limit=10&type=1&keywords=";
			const lyricURL = "https://music.xianqiao.wang/neteaseapiv2/lyric?id=";
			const requestHeader = {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:93.0) Gecko/20100101 Firefox/93.0",
			};

			const cleanTitle = LyricUtils.removeExtraInfo(LyricUtils.normalize(info.title));
			const finalURL = searchURL + encodeURIComponent(`${cleanTitle} ${info.artist}`);

			const searchResults = await CosmosAsync.get(finalURL, null, requestHeader);
			const items = searchResults.result.songs;
			if (!items || !items.length) {
				return { error: "Cannot find track" };
			}

			const itemId = pickNeteaseTrack(items, info);
			if (itemId === -1) return { error: "Cannot find track" };

			const meta = await CosmosAsync.get(lyricURL + items[itemId].id, null, requestHeader);
			let lyricStr = meta.lrc;

			if (!lyricStr || !lyricStr.lyric) {
				return { error: "No lyrics" };
			}
			lyricStr = lyricStr.lyric;
			return parseNeteaseLyrics(lyricStr);
		},

		async fetchLrclib(info: TrackInfo): Promise<LyricResult> {
			const baseURL = "https://lrclib.net/api/get";
			const durr = info.duration / 1000;
			const params: Record<string, string | number> = {
				track_name: info.title,
				artist_name: info.artist,
				album_name: info.album,
				duration: durr,
			};

			const finalURL = `${baseURL}?${Object.keys(params)
				.map((key) => `${key}=${encodeURIComponent(params[key])}`)
				.join("&")}`;

			const body = await fetch(finalURL, {
				headers: {
					"x-user-agent": `spicetify v${client.config.version} (https://github.com/spicetify/cli)`,
				},
			});

			if (body.status !== 200) {
				return { error: "Request error: Track wasn't found" };
			}

			const meta = await body.json();
			return parseLrclibBody(meta);
		},
	};

	const userConfigs = {
		smooth: boolLocalStorage("popup-lyrics:smooth"),
		centerAlign: boolLocalStorage("popup-lyrics:center-align"),
		showCover: boolLocalStorage("popup-lyrics:show-cover"),
		fontSize: Number(LocalStorage.get("popup-lyrics:font-size")),
		blurSize: Number(LocalStorage.get("popup-lyrics:blur-size")),
		fontFamily: LocalStorage.get("popup-lyrics:font-family") || "spotify-circular",
		ratio: LocalStorage.get("popup-lyrics:ratio") || "11",
		delay: Number(LocalStorage.get("popup-lyrics:delay")),
		backgroundImage: null as HTMLCanvasElement | null,
		services: {
			netease: {
				on: boolLocalStorage("popup-lyrics:services:netease:on"),
				call: LyricProviders.fetchNetease,
				desc: "Crowdsourced lyrics provider ran by Chinese developers and users.",
				token: "",
			},
			musixmatch: {
				on: boolLocalStorage("popup-lyrics:services:musixmatch:on"),
				call: LyricProviders.fetchMusixmatch,
				desc: "Fully compatible with Spotify. If lyrics stop loading, refresh the token below.",
				token:
					LocalStorage.get("popup-lyrics:services:musixmatch:token") ||
					"2005218b74f939209bda92cb633c7380612e14cb7fe92dcd6a780f",
			},
			spotify: {
				on: boolLocalStorage("popup-lyrics:services:spotify:on"),
				call: LyricProviders.fetchSpotify,
				desc: "Lyrics sourced from official Spotify API.",
				token: "",
			},
			lrclib: {
				on: boolLocalStorage("popup-lyrics:services:lrclib:on"),
				call: LyricProviders.fetchLrclib,
				desc: "Lyrics sourced from lrclib.net. Supports both synced and unsynced lyrics. LRCLIB is a free and open-source lyrics provider.",
				token: "",
			},
		} as Record<
			string,
			{
				on: boolean;
				call: (i: TrackInfo) => Promise<LyricResult>;
				desc: string;
				token: string;
			}
		>,
		servicesOrder: [] as string[],
	};

	userConfigs.fontSize = userConfigs.fontSize ? Number(userConfigs.fontSize) : 46;
	try {
		const rawServicesOrder = LocalStorage.get("popup-lyrics:services-order");
		userConfigs.servicesOrder = JSON.parse(rawServicesOrder ?? "");

		if (!Array.isArray(userConfigs.servicesOrder)) throw "";

		userConfigs.servicesOrder = userConfigs.servicesOrder.filter((s) => userConfigs.services[s]);

		const allServices = Object.keys(userConfigs.services);
		if (userConfigs.servicesOrder.length !== allServices.length) {
			for (const s of allServices) {
				if (!userConfigs.servicesOrder.includes(s)) {
					userConfigs.servicesOrder.push(s);
				}
			}
			LocalStorage.set("popup-lyrics:services-order", JSON.stringify(userConfigs.servicesOrder));
		}
	} catch {
		userConfigs.servicesOrder = Object.keys(userConfigs.services);
		LocalStorage.set("popup-lyrics:services-order", JSON.stringify(userConfigs.servicesOrder));
	}

	const lyricVideo = document.createElement("video");
	lyricVideo.muted = true;
	lyricVideo.width = 600;
	switch (userConfigs.ratio) {
		case "43":
			lyricVideo.height = Math.round((lyricVideo.width * 3) / 4);
			break;
		case "169":
			lyricVideo.height = Math.round((lyricVideo.width * 9) / 16);
			break;
		default:
			lyricVideo.height = lyricVideo.width;
			break;
	}

	let lyricVideoIsOpen = false;
	lyricVideo.onenterpictureinpicture = () => {
		lyricVideo.play();
		lyricVideoIsOpen = true;
		tick(userConfigs);
		updateTrack();
	};
	lyricVideo.onleavepictureinpicture = () => {
		lyricVideoIsOpen = false;
	};

	const lyricCanvas = document.createElement("canvas");
	lyricCanvas.width = lyricVideo.width;
	lyricCanvas.height = lyricVideo.height;

	const lyricCtx = lyricCanvas.getContext("2d")!;
	lyricVideo.srcObject = lyricCanvas.captureStream();
	lyricCtx.fillRect(0, 0, 1, 1);
	lyricVideo.play();

	const registrar = createRegistrar(ctx);
	// The client's own encore lyrics glyph (playbar lyrics button), so the
	// topbar entry matches the icon users already associate with lyrics.
	registrar.placeButton("topbar-right", {
		label: "Popup Lyrics",
		icon: '<path fill="currentColor" d="M13.426 2.574a2.831 2.831 0 0 0-4.797 1.55l3.247 3.247a2.831 2.831 0 0 0 1.55-4.797M10.5 8.118l-2.619-2.62L4.74 9.075 2.065 12.12a1.287 1.287 0 0 0 1.816 1.816l3.06-2.688 3.56-3.129zM7.12 4.094a4.331 4.331 0 1 1 4.786 4.786l-3.974 3.493-3.06 2.689a2.787 2.787 0 0 1-3.933-3.933l2.676-3.045z"/>',
		onClick: () => {
			if (!lyricVideoIsOpen) {
				lyricVideo.requestPictureInPicture();
			} else {
				document.exitPictureInPicture();
			}
		},
	});
	const coverCanvas = document.createElement("canvas");
	coverCanvas.width = lyricVideo.width;
	coverCanvas.height = lyricVideo.width;
	const coverCtx = coverCanvas.getContext("2d")!;

	const largeImage = new Image();
	largeImage.onload = () => {
		coverCtx.drawImage(largeImage, 0, 0, coverCtx.canvas.width, coverCtx.canvas.width);
	};
	userConfigs.backgroundImage = coverCanvas;

	let sharedData: LyricResult = { lyrics: [] };

	const onSongChange = () => {
		updateTrack();
	};
	Player.addEventListener("songchange", onSongChange);

	async function updateTrack(refresh = false) {
		if (!lyricVideoIsOpen) {
			return;
		}

		const meta = Player.data.item.metadata;

		if (!client.uri.isTrack(Player.data.item.uri) && !client.uri.isLocalTrack(Player.data.item.uri)) {
			return;
		}

		largeImage.src = meta.image_url;
		const info: TrackInfo = {
			duration: Number(meta.duration),
			album: meta.album_title,
			artist: meta.artist_name,
			title: meta.title,
			uri: Player.data.item.uri,
		};

		if (CACHE?.[info.uri]?.lyrics?.length && !refresh) {
			sharedData = CACHE[info.uri];
		} else {
			for (const name of userConfigs.servicesOrder) {
				const service = userConfigs.services[name];
				if (!service.on) continue;
				sharedData = { lyrics: [] };

				try {
					const data = await service.call(info);
					sharedData = data;
					CACHE[info.uri] = sharedData;

					if (!sharedData.error) {
						return;
					}
				} catch (_err) {
					sharedData = { error: "No lyrics" };
				}
			}
		}
	}

	// simple word segmentation rules
	function getWords(str: string): string[] {
		const result: string[] = [];
		const words = str.split(/(\p{sc=Han}|\p{sc=Katakana}|\p{sc=Hiragana}|\p{sc=Hang}|\p{gc=Punctuation})|\s+/gu);
		let tempWord = "";
		for (let word of words) {
			word ??= " ";
			if (word) {
				if (tempWord && /(“|')$/.test(tempWord) && word !== " ") {
					tempWord += word;
				} else if (/(,|\.|\?|:|;|'|，|。|？|：|；|”)/.test(word) && tempWord !== " ") {
					tempWord += word;
				} else {
					if (tempWord) result.push(tempWord);
					tempWord = word;
				}
			}
		}
		if (tempWord) result.push(tempWord);
		return result;
	}

	function drawParagraph(ctx: CanvasRenderingContext2D, str: string, options: ParagraphOptions) {
		let actualWidth = 0;
		const maxWidth = ctx.canvas.width - options.left - options.right;
		const words = getWords(str);
		const lines: string[] = [];
		const measures: TextMetrics[] = [];
		let tempLine = "";
		let textMeasures = ctx.measureText("");
		for (let i = 0; i < words.length; i++) {
			const word = words[i];
			const line = tempLine + word;
			const mea = ctx.measureText(line);
			const isSpace = /\s/.test(word);
			if (mea.width > maxWidth && tempLine && !isSpace) {
				actualWidth = Math.max(actualWidth, textMeasures.width);
				lines.push(tempLine);
				measures.push(textMeasures);
				tempLine = word;
			} else {
				tempLine = line;
				if (!isSpace) {
					textMeasures = mea;
				}
			}
		}
		if (tempLine !== "") {
			actualWidth = Math.max(actualWidth, textMeasures.width);
			lines.push(tempLine);
			measures.push(ctx.measureText(tempLine));
		}

		const ascent = measures.length ? measures[0].actualBoundingBoxAscent : 0;
		const body = measures.length ? options.lineHeight * (measures.length - 1) : 0;
		const descent = measures.length ? measures[measures.length - 1].actualBoundingBoxDescent : 0;
		const actualHeight = ascent + body + descent;

		let startX = 0;
		let startY = 0;
		let translateX = 0;
		let translateY = 0;
		if (options.hCenter) {
			startX = (ctx.canvas.width - actualWidth) / 2;
		} else {
			startX = options.left + translateX;
		}

		if (options.vCenter) {
			startY = (ctx.canvas.height - actualHeight) / 2 + ascent;
		} else if (options.top) {
			startY = options.top + ascent;
		} else if (options.bottom) {
			startY = options.bottom - descent - body;
		}

		if (typeof options.translateX === "function") {
			translateX = options.translateX(actualWidth);
		}
		if (typeof options.translateX === "number") {
			translateX = options.translateX;
		}
		if (typeof options.translateY === "function") {
			translateY = options.translateY(actualHeight);
		}
		if (typeof options.translateY === "number") {
			translateY = options.translateY;
		}
		if (!options.measure) {
			lines.forEach((line, index) => {
				const x = options.hCenter ? (ctx.canvas.width - measures[index].width) / 2 : startX;
				ctx.fillText(line, x, startY + index * options.lineHeight + translateY);
			});
		}
		return {
			width: actualWidth,
			height: actualHeight,
			left: startX + translateX,
			right: ctx.canvas.width - options.left - actualWidth + translateX,
			top: startY - ascent + translateY,
			bottom: startY + body + descent + translateY,
		};
	}

	function drawBackground(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement) {
		if (userConfigs.showCover) {
			const { width, height } = ctx.canvas;
			ctx.imageSmoothingEnabled = false;
			ctx.save();
			const blurSize = Number(userConfigs.blurSize);
			ctx.filter = `blur(${blurSize}px)`;
			ctx.drawImage(
				image,
				-blurSize * 2,
				-blurSize * 2 - (width - height) / 2,
				width + 4 * blurSize,
				width + 4 * blurSize,
			);
			ctx.restore();
			ctx.fillStyle = "#000000b0";
		} else {
			ctx.save();
			ctx.fillStyle = "#000000";
		}

		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		ctx.restore();
	}

	function drawText(ctx: CanvasRenderingContext2D, text: string, color = "white") {
		drawBackground(ctx, userConfigs.backgroundImage!);
		const fontSize = userConfigs.fontSize;
		ctx.fillStyle = color;
		ctx.font = `bold ${fontSize}px ${userConfigs.fontFamily}, sans-serif`;
		drawParagraph(ctx, text, {
			vCenter: true,
			hCenter: true,
			left: 0,
			right: 0,
			lineHeight: fontSize,
		});
		ctx.restore();
	}

	let offscreenCanvas: HTMLCanvasElement | undefined;
	let offscreenCtx: CanvasRenderingContext2D | null | undefined;
	let gradient1: CanvasGradient | undefined;
	let gradient2: CanvasGradient | undefined;

	function initOffscreenCtx(ctx: CanvasRenderingContext2D) {
		if (!offscreenCtx) {
			offscreenCanvas = document.createElement("canvas");
			offscreenCtx = offscreenCanvas.getContext("2d")!;
			gradient1 = offscreenCtx.createLinearGradient(0, 0, 0, ctx.canvas.height);
			gradient1.addColorStop(0.08, "transparent");
			gradient1.addColorStop(0.15, "white");
			gradient1.addColorStop(0.85, "white");
			gradient1.addColorStop(0.92, "transparent");
			gradient2 = offscreenCtx.createLinearGradient(0, 0, 0, ctx.canvas.height);
			gradient2.addColorStop(0.0, "white");
			gradient2.addColorStop(0.7, "white");
			gradient2.addColorStop(0.925, "transparent");
		}
		offscreenCtx.canvas.width = ctx.canvas.width;
		offscreenCtx.canvas.height = ctx.canvas.height;
		return {
			offscreenCtx,
			gradient1: gradient1!,
			gradient2: gradient2!,
		};
	}

	// Avoid drawing again when the same. Do not operate canvas again in other functions.
	let renderState: Record<string, unknown> | undefined;

	function isEqualState(state1?: Record<string, unknown>, state2?: Record<string, unknown>): boolean {
		if (!state1 || !state2) return false;
		return Object.keys(state1).reduce((p: boolean, c) => {
			return p && state1[c] === state2[c];
		}, true);
	}

	function renderLyrics(ctx: CanvasRenderingContext2D, lyrics: Lyric[], currentTime: number) {
		const focusLineFontSize = userConfigs.fontSize;
		const focusLineHeight = focusLineFontSize * 1.2;
		const focusLineMargin = focusLineFontSize * 1;
		const otherLineFontSize = focusLineFontSize * 1;
		const otherLineHeight = otherLineFontSize * 1.2;
		const otherLineMargin = otherLineFontSize * 1;
		const otherLineOpacity = 0.35;
		const marginWidth = ctx.canvas.width * 0.075;
		const animateDuration = userConfigs.smooth ? 0.3 : 0;
		const hCenter = userConfigs.centerAlign;
		const fontFamily = `${userConfigs.fontFamily}, sans-serif`;

		let currentIndex = -1;
		let progress = 1;
		lyrics.forEach(({ startTime }, index) => {
			if (startTime && currentTime > startTime - animateDuration) {
				currentIndex = index;
				if (currentTime < startTime) {
					progress = (currentTime - startTime + animateDuration) / animateDuration;
				}
			}
		});

		if (currentIndex === -1) {
			drawText(ctx, "");
			return;
		}

		const nextState = {
			...userConfigs,
			currentIndex,
			lyrics,
			progress,
		};
		if (isEqualState(nextState as Record<string, unknown>, renderState)) return;
		renderState = nextState as Record<string, unknown>;

		drawBackground(ctx, userConfigs.backgroundImage!);

		const { offscreenCtx, gradient1 } = initOffscreenCtx(ctx);
		offscreenCtx.save();

		// focus line
		const fFontSize = otherLineFontSize + progress * (focusLineFontSize - otherLineFontSize);
		const fLineHeight = otherLineHeight + progress * (focusLineHeight - otherLineHeight);
		const fLineOpacity = otherLineOpacity + progress * (1 - otherLineOpacity);
		const otherRight =
			ctx.canvas.width -
			marginWidth -
			(otherLineFontSize / focusLineFontSize) * (ctx.canvas.width - 2 * marginWidth);
		const progressRight = marginWidth + (1 - progress) * (otherRight - marginWidth);
		offscreenCtx.fillStyle = `rgba(255, 255, 255, ${fLineOpacity})`;
		offscreenCtx.font = `bold ${fFontSize}px ${fontFamily}`;
		const prevLineFocusHeight = drawParagraph(
			offscreenCtx,
			lyrics[currentIndex - 1] ? lyrics[currentIndex - 1].text : "",
			{
				vCenter: true,
				hCenter,
				left: marginWidth,
				right: marginWidth,
				lineHeight: focusLineFontSize,
				measure: true,
			},
		).height;

		const pos = drawParagraph(offscreenCtx, lyrics[currentIndex].text, {
			vCenter: true,
			hCenter,
			left: marginWidth,
			right: progressRight,
			lineHeight: fLineHeight,
			translateY: (selfHeight) => ((prevLineFocusHeight + selfHeight) / 2 + focusLineMargin) * (1 - progress),
		});

		// prev line
		let lastBeforePos = pos;
		for (let i = 0; i < currentIndex; i++) {
			if (i === 0) {
				const prevProgressLineFontSize =
					otherLineFontSize + (1 - progress) * (focusLineFontSize - otherLineFontSize);
				const prevProgressLineOpacity = otherLineOpacity + (1 - progress) * (1 - otherLineOpacity);
				offscreenCtx.fillStyle = `rgba(255, 255, 255, ${prevProgressLineOpacity})`;
				offscreenCtx.font = `bold ${prevProgressLineFontSize}px ${fontFamily}`;
			} else {
				offscreenCtx.fillStyle = `rgba(255, 255, 255, ${otherLineOpacity})`;
				offscreenCtx.font = `bold ${otherLineFontSize}px ${fontFamily}`;
			}
			lastBeforePos = drawParagraph(offscreenCtx, lyrics[currentIndex - 1 - i].text, {
				hCenter,
				bottom: i === 0 ? lastBeforePos.top - focusLineMargin : lastBeforePos.top - otherLineMargin,
				left: marginWidth,
				right: i === 0 ? marginWidth + progress * (otherRight - marginWidth) : otherRight,
				lineHeight:
					i === 0 ? otherLineHeight + (1 - progress) * (focusLineHeight - otherLineHeight) : otherLineHeight,
			});
			if (lastBeforePos.top < 0) break;
		}
		// next line
		offscreenCtx.fillStyle = `rgba(255, 255, 255, ${otherLineOpacity})`;
		offscreenCtx.font = `bold ${otherLineFontSize}px ${fontFamily}`;
		let lastAfterPos = pos;
		for (let i = currentIndex + 1; i < lyrics.length; i++) {
			lastAfterPos = drawParagraph(offscreenCtx, lyrics[i].text, {
				hCenter,
				top:
					i === currentIndex + 1
						? lastAfterPos.bottom + focusLineMargin
						: lastAfterPos.bottom + otherLineMargin,
				left: marginWidth,
				right: otherRight,
				lineHeight: otherLineHeight,
			});
			if (lastAfterPos.bottom > ctx.canvas.height) break;
		}

		offscreenCtx.globalCompositeOperation = "source-in";
		offscreenCtx.fillStyle = gradient1;
		offscreenCtx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		offscreenCtx.restore();
		ctx.drawImage(offscreenCtx.canvas, 0, 0);

		ctx.restore();
	}

	let timeout: number | null = null;

	async function tick(options: typeof userConfigs) {
		if (!lyricVideoIsOpen) {
			return;
		}

		if (timeout) clearTimeout(timeout);

		const audio = {
			currentTime: (Player.getProgress() - Number(options.delay)) / 1000,
			duration: Player.getDuration() / 1000,
		};

		const { error, lyrics } = sharedData;

		if (error) {
			if (error === "Instrumental") {
				drawText(lyricCtx, error);
			} else {
				drawText(lyricCtx, error, "red");
			}
		} else if (!lyrics) {
			drawText(lyricCtx, "No lyrics");
		} else if (audio.duration && lyrics.length) {
			renderLyrics(lyricCtx, lyrics, audio.currentTime);
		} else if (!audio.duration || lyrics.length === 0) {
			drawText(lyricCtx, "Waiting");
		}

		if (!lyrics?.length) {
			timeout = window.setTimeout(tick, 1000, options);
			return;
		}

		if (!document.hidden) {
			requestAnimationFrame(() => tick(options));
		}
	}

	function boolLocalStorage(name: string, defaultVal = true): boolean {
		const value = LocalStorage.get(name);
		return value ? value === "true" : defaultVal;
	}

	const ASPECT_RATIO_OPTIONS = [
		{ value: "11", label: "1:1" },
		{ value: "43", label: "4:3" },
		{ value: "169", label: "16:9" },
	] as const;
	const FONT_SIZE_OPTIONS = [30, 34, 38, 42, 46, 50, 54, 58].map((value) => ({
		value: String(value),
		label: `${value}px`,
	}));
	const BLUR_SIZE_OPTIONS = [0, 2, 5, 10, 15].map((value) => ({
		value: String(value),
		label: value === 0 ? "Off" : `${value}px`,
	}));

	type BooleanSettingProps = {
		label: string;
		value: boolean;
		onChange: (value: boolean) => void;
	};

	const BooleanSetting = ({ label, value, onChange }: BooleanSettingProps) => {
		const id = React.useId();
		return (
			<SettingsRow label={label} htmlFor={id}>
				<Toggle id={id} value={value} onChange={onChange} />
			</SettingsRow>
		);
	};

	type ServiceSettingProps = {
		id: string;
		index: number;
		total: number;
		onToggle: (value: boolean) => void;
		onMove: (direction: -1 | 1) => void;
	};

	const ServiceSetting = ({ id, index, total, onToggle, onMove }: ServiceSettingProps) => {
		const toggleId = React.useId();
		const service = userConfigs.services[id];
		const name = id.replace(/^./, (character) => character.toUpperCase());
		return (
			<SettingsRow
				label={
					<span className="popup-lyrics-setting-copy">
						<span>{name}</span>
						<span className={SETTINGS_HELP_TEXT_CLASS}>{service.desc}</span>
					</span>
				}
				htmlFor={toggleId}
			>
				<div className="popup-lyrics-service-actions">
					<IconButton ariaLabel={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)}>
						↑
					</IconButton>
					<IconButton
						ariaLabel={`Move ${name} down`}
						disabled={index === total - 1}
						onClick={() => onMove(1)}
					>
						↓
					</IconButton>
					<Toggle id={toggleId} value={service.on} onChange={onToggle} />
				</div>
			</SettingsRow>
		);
	};

	const resizeLyricsSurface = () => {
		const height =
			userConfigs.ratio === "43"
				? Math.round((lyricVideo.width * 3) / 4)
				: userConfigs.ratio === "169"
					? Math.round((lyricVideo.width * 9) / 16)
					: lyricVideo.width;
		lyricVideo.height = lyricCanvas.height = height;
		offscreenCtx = null;
	};

	const PopupLyricsSettings = () => {
		const [, render] = React.useReducer((value: number) => value + 1, 0);
		const [tokenStatus, setTokenStatus] = React.useState<"idle" | "refreshing" | "success" | "error">("idle");

		const setBoolean = (field: "smooth" | "centerAlign" | "showCover", storageKey: string, value: boolean) => {
			userConfigs[field] = value;
			LocalStorage.set(storageKey, String(value));
			render();
		};
		const moveService = (id: string, direction: -1 | 1) => {
			const current = userConfigs.servicesOrder.indexOf(id);
			const next = current + direction;
			if (current < 0 || next < 0 || next >= userConfigs.servicesOrder.length) return;
			[userConfigs.servicesOrder[current], userConfigs.servicesOrder[next]] = [
				userConfigs.servicesOrder[next],
				userConfigs.servicesOrder[current],
			];
			LocalStorage.set("popup-lyrics:services-order", JSON.stringify(userConfigs.servicesOrder));
			render();
			void updateTrack(true);
		};
		const refreshToken = async () => {
			setTokenStatus("refreshing");
			const token = await refreshMusixmatchToken();
			setTokenStatus(token ? "success" : "error");
			if (token) {
				render();
				void updateTrack(true);
			}
		};

		return (
			<>
				<SettingsSection title="Popup Lyrics">
					<BooleanSetting
						label="Smooth scrolling"
						value={userConfigs.smooth}
						onChange={(value) => setBoolean("smooth", "popup-lyrics:smooth", value)}
					/>
					<BooleanSetting
						label="Center lyrics"
						value={userConfigs.centerAlign}
						onChange={(value) => setBoolean("centerAlign", "popup-lyrics:center-align", value)}
					/>
					<BooleanSetting
						label="Show cover art"
						value={userConfigs.showCover}
						onChange={(value) => setBoolean("showCover", "popup-lyrics:show-cover", value)}
					/>
					<SettingsRow label="Aspect ratio">
						<Select
							options={ASPECT_RATIO_OPTIONS}
							value={userConfigs.ratio as (typeof ASPECT_RATIO_OPTIONS)[number]["value"]}
							onChange={(value) => {
								userConfigs.ratio = value;
								LocalStorage.set("popup-lyrics:ratio", value);
								resizeLyricsSurface();
								render();
							}}
						/>
					</SettingsRow>
					<SettingsRow label="Font size">
						<Select
							options={FONT_SIZE_OPTIONS}
							value={String(userConfigs.fontSize)}
							onChange={(value) => {
								userConfigs.fontSize = Number(value);
								LocalStorage.set("popup-lyrics:font-size", value);
								render();
							}}
						/>
					</SettingsRow>
					<SettingsRow label="Background blur">
						<Select
							options={BLUR_SIZE_OPTIONS}
							value={String(userConfigs.blurSize)}
							onChange={(value) => {
								userConfigs.blurSize = Number(value);
								LocalStorage.set("popup-lyrics:blur-size", value);
								render();
							}}
						/>
					</SettingsRow>
					<SettingsRow label="Timing delay (ms)">
						<TextInput
							placeholder="0"
							value={String(userConfigs.delay)}
							onInput={(value) => {
								userConfigs.delay = Number(value) || 0;
								LocalStorage.set("popup-lyrics:delay", String(userConfigs.delay));
								render();
							}}
						/>
					</SettingsRow>
					<SettingsRow label="Memory cache">
						<Button
							variant="secondary"
							onClick={() => {
								CACHE = {};
								void updateTrack();
							}}
						>
							Clear cached lyrics
						</Button>
					</SettingsRow>
				</SettingsSection>
				<SettingsSection title="Popup Lyrics providers">
					{userConfigs.servicesOrder.map((id, index) => (
						<ServiceSetting
							key={id}
							id={id}
							index={index}
							total={userConfigs.servicesOrder.length}
							onMove={(direction) => moveService(id, direction)}
							onToggle={(value) => {
								userConfigs.services[id].on = value;
								LocalStorage.set(`popup-lyrics:services:${id}:on`, String(value));
								render();
								void updateTrack(true);
							}}
						/>
					))}
					<SettingsRow label="Musixmatch token">
						<div className="popup-lyrics-token-controls">
							<TextInput
								placeholder="Musixmatch user token"
								value={userConfigs.services.musixmatch.token}
								onInput={(value) => {
									userConfigs.services.musixmatch.token = value;
									LocalStorage.set("popup-lyrics:services:musixmatch:token", value);
									render();
								}}
							/>
							<Button
								variant="secondary"
								disabled={tokenStatus === "refreshing"}
								onClick={() => void refreshToken()}
							>
								{tokenStatus === "refreshing"
									? "Refreshing…"
									: tokenStatus === "success"
										? "Token refreshed"
										: tokenStatus === "error"
											? "Try again"
											: "Refresh token"}
							</Button>
						</div>
					</SettingsRow>
				</SettingsSection>
			</>
		);
	};

	registrar.register("settingsSection", <PopupLyricsSettings />);

	// ----- teardown -----
	ctx.defer(() => {
		document.removeEventListener("visibilitychange", onVisibility);
		Player.removeEventListener("songchange", onSongChange);
		worker?.terminate();
		if (workerUrl) URL.revokeObjectURL(workerUrl);
		if (timeout) clearTimeout(timeout);
		if (lyricVideoIsOpen && document.pictureInPictureElement) {
			document.exitPictureInPicture().catch(() => {});
		}
		// The topbar button is removed by the registrar's own ctx.defer.
	});
}
