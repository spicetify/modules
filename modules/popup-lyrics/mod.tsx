/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Popup Lyrics" extension by
 * khanhas (Netease parser + UI from github.com/mantou132/Spotify-Lyrics). It
 * renders synced lyrics onto a canvas that is streamed into a picture-in-picture
 * window, toggled from a topbar button (right-click for settings).
 *
 * v3 adaptations, everything else is kept near-verbatim:
 *   - The classic build loaded its own file twice (main + Web Worker) and
 *     branched on navigator.serviceWorker. A bundled module cannot re-load its
 *     own path, so the "keep ticking while the window is hidden" worker is now
 *     an inline Blob worker (CSP-permitted in the client).
 *   - The topbar button goes through registrar.placeButton("topbar-right"), so
 *     it sits with the other module topbar buttons; right-click (settings) is
 *     delegated at the document level since placeButton exposes no element.
 *   - The injected <style> tag moved into index.scss.
 *   - All teardown routes through ctx.defer.
 *   - CosmosAsync still proxies both the authed Spotify color-lyrics endpoint
 *     and external provider hosts in v3, so the providers are unchanged; LRCLIB
 *     is CORS-enabled and keeps using plain fetch.
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

interface Lyric {
	startTime: number | null;
	text: string;
}
type LyricResult = { lyrics: Lyric[]; error?: undefined } | { error: string; lyrics?: undefined };

interface TrackInfo {
	duration: number;
	album: string;
	artist: string;
	title: string;
	uri: string;
}

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
	const { Player, CosmosAsync, LocalStorage } = Spicetify;
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

	const LyricUtils = {
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

			const lyricsData = body.lyrics;
			if (!lyricsData || lyricsData.syncType !== "LINE_SYNCED") {
				return { error: "No lyrics" };
			}

			const lines = lyricsData.lines;
			const lyrics = lines.map((a: { startTimeMs: string; words: string }) => ({
				startTime: Number(a.startTimeMs) / 1000,
				text: a.words,
			}));

			return { lyrics };
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
					const subtitle = body["track.subtitles.get"].message.body.subtitle_list[0].subtitle;

					const lyrics = JSON.parse(subtitle.subtitle_body).map(
						(line: { text: string; time: { total: number } }) => ({
							text: line.text || "♪",
							startTime: line.time.total,
						}),
					);
					return { lyrics };
				}

				return { error: "No lyrics" };
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

			const album = LyricUtils.capitalize(info.album);
			const itemId = items.findIndex(
				(val: { album: { name: string }; duration: number }) =>
					LyricUtils.capitalize(val.album.name) === album || Math.abs(info.duration - val.duration) < 1000,
			);
			if (itemId === -1) return { error: "Cannot find track" };

			const meta = await CosmosAsync.get(lyricURL + items[itemId].id, null, requestHeader);
			let lyricStr = meta.lrc;

			if (!lyricStr || !lyricStr.lyric) {
				return { error: "No lyrics" };
			}
			lyricStr = lyricStr.lyric;

			const otherInfoKeys = [
				"\\s?作?\\s*词|\\s?作?\\s*曲|\\s?编\\s*曲?|\\s?监\\s*制?",
				".*编写|.*和音|.*和声|.*合声|.*提琴|.*录|.*工程|.*工作室|.*设计|.*剪辑|.*制作|.*发行|.*出品|.*后期|.*混音|.*缩混",
				"原唱|翻唱|题字|文案|海报|古筝|二胡|钢琴|吉他|贝斯|笛子|鼓|弦乐",
				"lrc|publish|vocal|guitar|program|produce|write|mix",
			];
			const otherInfoRegexp = new RegExp(`^(${otherInfoKeys.join("|")}).*(:|：)`, "i");

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
				.filter(Boolean);

			if (noLyrics) {
				return { error: "No lyrics" };
			}
			if (!lyrics.length) {
				return { error: "No synced lyrics" };
			}

			return { lyrics };
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
					"x-user-agent": `spicetify v${Spicetify.Config.version} (https://github.com/spicetify/cli)`,
				},
			});

			if (body.status !== 200) {
				return { error: "Request error: Track wasn't found" };
			}

			const meta = await body.json();
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
			});

			return { lyrics };
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
				element: null as HTMLElement | null,
			},
			musixmatch: {
				on: boolLocalStorage("popup-lyrics:services:musixmatch:on"),
				call: LyricProviders.fetchMusixmatch,
				desc: "Fully compatible with Spotify. Requires a token that can be retrieved from the official Musixmatch app. If you have problems with retrieving lyrics, try refreshing the token by clicking <code>Refresh Token</code> button.",
				token:
					LocalStorage.get("popup-lyrics:services:musixmatch:token") ||
					"2005218b74f939209bda92cb633c7380612e14cb7fe92dcd6a780f",
				element: null as HTMLElement | null,
			},
			spotify: {
				on: boolLocalStorage("popup-lyrics:services:spotify:on"),
				call: LyricProviders.fetchSpotify,
				desc: "Lyrics sourced from official Spotify API.",
				token: "",
				element: null as HTMLElement | null,
			},
			lrclib: {
				on: boolLocalStorage("popup-lyrics:services:lrclib:on"),
				call: LyricProviders.fetchLrclib,
				desc: "Lyrics sourced from lrclib.net. Supports both synced and unsynced lyrics. LRCLIB is a free and open-source lyrics provider.",
				token: "",
				element: null as HTMLElement | null,
			},
		} as Record<
			string,
			{
				on: boolean;
				call: (i: TrackInfo) => Promise<LyricResult>;
				desc: string;
				token: string;
				element: HTMLElement | null;
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
	// Right-click the topbar button opens settings. placeButton exposes no
	// element handle, so delegate at the document level (like loopy-loop).
	const onButtonContextMenu = (event: MouseEvent) => {
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('.spicetify-topbar-right-buttons [aria-label="Popup Lyrics"]')) {
			openConfig(event);
		}
	};
	document.addEventListener("contextmenu", onButtonContextMenu);

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

		if (!Spicetify.URI.isTrack(Player.data.item.uri) && !Spicetify.URI.isLocalTrack(Player.data.item.uri)) {
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

	let configContainer: HTMLDivElement | undefined;

	function openConfig(event: MouseEvent) {
		event.preventDefault();

		// Reset on reopen
		if (configContainer) {
			resetTokenButton(configContainer);
		} else {
			configContainer = document.createElement("div");
			configContainer.id = "popup-config-container";
			const optionHeader = document.createElement("h2");
			optionHeader.innerText = "Options";
			const smooth = createSlider("Smooth scrolling", userConfigs.smooth, (state) => {
				userConfigs.smooth = state;
				LocalStorage.set("popup-lyrics:smooth", String(state));
			});
			const center = createSlider("Center align", userConfigs.centerAlign, (state) => {
				userConfigs.centerAlign = state;
				LocalStorage.set("popup-lyrics:center-align", String(state));
			});
			const cover = createSlider("Show cover", userConfigs.showCover, (state) => {
				userConfigs.showCover = state;
				LocalStorage.set("popup-lyrics:show-cover", String(state));
			});
			const ratio = createOptions(
				"Aspect ratio",
				{ 11: "1:1", 43: "4:3", 169: "16:9" },
				userConfigs.ratio,
				(state) => {
					userConfigs.ratio = state;
					LocalStorage.set("popup-lyrics:ratio", state);
					let value = lyricVideo.width;
					switch (userConfigs.ratio) {
						case "11":
							value = lyricVideo.width;
							break;
						case "43":
							value = Math.round((lyricVideo.width * 3) / 4);
							break;
						case "169":
							value = Math.round((lyricVideo.width * 9) / 16);
							break;
					}
					lyricVideo.height = lyricCanvas.height = value;
					offscreenCtx = null;
				},
			);
			const fontSize = createOptions(
				"Font size",
				{ 30: "30px", 34: "34px", 38: "38px", 42: "42px", 46: "46px", 50: "50px", 54: "54px", 58: "58px" },
				String(userConfigs.fontSize),
				(state) => {
					userConfigs.fontSize = Number(state);
					LocalStorage.set("popup-lyrics:font-size", state);
				},
			);
			const blurSize = createOptions(
				"Blur size",
				{ 2: "2px", 5: "5px", 10: "10px", 15: "15px" },
				String(userConfigs.blurSize),
				(state) => {
					userConfigs.blurSize = Number(state);
					LocalStorage.set("popup-lyrics:blur-size", state);
				},
			);
			const delay = createOptionsInput("Delay", String(userConfigs.delay), (state) => {
				userConfigs.delay = Number(state);
				LocalStorage.set("popup-lyrics:delay", state);
			});
			const clearCache = descriptiveElement(
				createButton("Clear Memory Cache", "Clear Memory Cache", () => {
					CACHE = {};
					updateTrack();
				}),
				"Loaded lyrics are cached in memory for faster reloading. Press this button to clear the cached lyrics from memory without restarting Spotify.",
			);

			const serviceHeader = document.createElement("h2");
			serviceHeader.innerText = "Services";

			const serviceContainer = document.createElement("div");

			function stackServiceElements() {
				userConfigs.servicesOrder.forEach((name, index) => {
					const el = userConfigs.services[name].element!;

					const [up, down] = el.querySelectorAll("button");
					if (index === 0) {
						up.disabled = true;
						down.disabled = false;
					} else if (index === userConfigs.servicesOrder.length - 1) {
						up.disabled = false;
						down.disabled = true;
					} else {
						up.disabled = false;
						down.disabled = false;
					}

					serviceContainer.append(el);
				});
			}

			function switchCallback(el: HTMLElement, state: boolean) {
				const id = el.dataset.id!;
				userConfigs.services[id].on = state;
				LocalStorage.set(`popup-lyrics:services:${id}:on`, String(state));
				updateTrack(true);
			}

			function posCallback(el: HTMLElement, dir: number) {
				const id = el.dataset.id!;
				const curPos = userConfigs.servicesOrder.findIndex((val) => val === id);
				const newPos = curPos + dir;

				const temp = userConfigs.servicesOrder[newPos];
				userConfigs.servicesOrder[newPos] = userConfigs.servicesOrder[curPos];
				userConfigs.servicesOrder[curPos] = temp;

				LocalStorage.set("popup-lyrics:services-order", JSON.stringify(userConfigs.servicesOrder));

				stackServiceElements();
				updateTrack(true);
			}

			for (const name of userConfigs.servicesOrder) {
				userConfigs.services[name].element = createServiceOption(
					name,
					userConfigs.services[name],
					switchCallback,
					posCallback,
				);
			}
			stackServiceElements();

			configContainer.append(
				optionHeader,
				smooth,
				center,
				cover,
				blurSize,
				fontSize,
				ratio,
				delay,
				clearCache,
				serviceHeader,
				serviceContainer,
			);
		}
		Spicetify.PopupModal.display({
			title: "Popup Lyrics",
			content: configContainer,
		});
	}

	function createSlider(name: string, defaultVal: boolean, callback: (state: boolean) => void): HTMLDivElement {
		const container = document.createElement("div");
		container.innerHTML = `
<div class="setting-row">
	<label class="col description">${name}</label>
	<div class="col action"><button class="switch">
		<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">
			${Spicetify.SVGIcons.check}
		</svg>
	</button></div>
</div>`;

		const slider = container.querySelector("button")!;
		slider.classList.toggle("disabled", !defaultVal);

		slider.onclick = () => {
			const state = slider.classList.contains("disabled");
			slider.classList.toggle("disabled");
			callback(state);
		};

		return container;
	}

	function createOptions(
		name: string,
		options: Record<string, string>,
		defaultValue: string,
		callback: (state: string) => void,
	): HTMLDivElement {
		const container = document.createElement("div");
		container.innerHTML = `
<div class="setting-row">
	<label class="col description">${name}</label>
	<div class="col action">
		<select>
			${Object.keys(options)
				.map((item) => `<option value="${item}" dir="auto">${options[item]}</option>`)
				.join("\n")}
		</select>
	</div>
</div>`;

		const select = container.querySelector("select")!;
		select.value = defaultValue;
		select.onchange = (e) => {
			callback((e.target as HTMLSelectElement).value);
		};

		return container;
	}

	function createOptionsInput(name: string, defaultValue: string, callback: (state: string) => void): HTMLDivElement {
		const container = document.createElement("div");
		container.innerHTML = `
	<div class="setting-row">
	<label class="col description">${name}</label>
	<div class="col action">
		<input id="popup-lyrics-delay-input" type="number" />
	</div>
	</div>`;

		const input = container.querySelector("#popup-lyrics-delay-input") as HTMLInputElement;
		input.value = defaultValue;
		input.onchange = (e) => {
			callback((e.target as HTMLInputElement).value);
		};

		return container;
	}

	// if name is null, the element can be used without a description.
	function createButton(name: string | null, defaultValue: string, callback: () => void): HTMLElement {
		let container: HTMLElement;

		if (name) {
			container = document.createElement("div");
			container.innerHTML = `
		<div class="setting-row">
		<label class="col description">${name}</label>
		<div class="col action">
			<button id="popup-lyrics-clickbutton" class="btn">${defaultValue}</button>
		</div>
		</div>`;

			const button = container.querySelector("#popup-lyrics-clickbutton") as HTMLButtonElement;
			button.onclick = () => callback();
		} else {
			container = document.createElement("button");
			container.innerHTML = defaultValue;
			container.className = "btn ";
			container.onclick = () => callback();
		}

		return container;
	}

	// if name is null, the element can be used without a description.
	function createTextfield(
		name: string | null,
		defaultValue: string,
		placeholder: string,
		callback: (value: string) => void,
	): HTMLElement {
		let container: HTMLElement;

		if (name) {
			container = document.createElement("div");
			container.className = "setting-column";
			const label = document.createElement("label");
			label.className = "row-description";
			label.textContent = name;
			const wrap = document.createElement("div");
			wrap.className = "popup-row-option action";
			const input = document.createElement("input");
			input.id = "popup-lyrics-textfield";
			input.placeholder = placeholder;
			input.value = defaultValue;
			input.onchange = () => callback(input.value);
			wrap.append(input);
			container.append(label, wrap);
		} else {
			const input = document.createElement("input");
			input.placeholder = placeholder;
			input.value = defaultValue;
			input.onchange = (e) => callback((e.target as HTMLInputElement).value);
			container = input;
		}

		return container;
	}

	function descriptiveElement(element: HTMLElement, description: string): HTMLElement {
		const desc = document.createElement("span");
		desc.innerHTML = description;
		element.append(desc);
		return element;
	}

	function resetTokenButton(container: HTMLElement) {
		const button = container.querySelector("#popup-lyrics-refresh-token") as HTMLButtonElement | null;
		if (button) {
			button.innerHTML = "Refresh token";
			button.disabled = false;
		}
	}

	function musixmatchTokenElements(defaultVal: { token: string }): HTMLDivElement {
		const button = createButton(null, "Refresh token", clickRefresh) as HTMLButtonElement;
		button.className += "popup-config-col-margin";
		button.id = "popup-lyrics-refresh-token";
		const textfield = createTextfield(
			null,
			defaultVal.token,
			"Place your musixmatch token here",
			changeTokenfield,
		) as HTMLInputElement;
		textfield.className += "popup-config-col-margin";

		function clickRefresh() {
			button.innerHTML = "Refreshing token...";
			button.disabled = true;

			Spicetify.CosmosAsync.get(
				"https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0",
				null,
				{
					authority: "apic-desktop.musixmatch.com",
				},
			)
				.then(({ message: response }: any) => {
					if (response.header.status_code === 200 && response.body.user_token) {
						button.innerHTML = "Token refreshed";
						textfield.value = response.body.user_token;
						textfield.dispatchEvent(new Event("change"));
					} else if (response.header.status_code === 401) {
						button.innerHTML = "Too many attempts";
					} else {
						button.innerHTML = "Failed to refresh token";
						console.error("Failed to refresh token", response);
					}
				})
				.catch((error: unknown) => {
					button.innerHTML = "Failed to refresh token";
					console.error("Failed to refresh token", error);
				});
		}

		function changeTokenfield(value: string) {
			userConfigs.services.musixmatch.token = value;
			LocalStorage.set("popup-lyrics:services:musixmatch:token", value);
			updateTrack(true);
		}

		const container = document.createElement("div");
		container.append(button);
		container.append(textfield);
		return container;
	}

	function createServiceOption(
		id: string,
		defaultVal: { on: boolean; desc: string },
		switchCallback: (el: HTMLElement, state: boolean) => void,
		posCallback: (el: HTMLElement, dir: number) => void,
	): HTMLDivElement {
		const name = id.replace(/^./, (c) => c.toUpperCase());

		const container = document.createElement("div");
		container.dataset.id = id;
		container.innerHTML = `
<div class="setting-row">
	<h3 class="col description">${name}</h3>
	<div class="col action">
		<button class="switch small">
			<svg height="10" width="10" viewBox="0 0 16 16" fill="currentColor">
				${Spicetify.SVGIcons["chart-up"]}
			</svg>
		</button>
		<button class="switch small">
			<svg height="10" width="10" viewBox="0 0 16 16" fill="currentColor">
				${Spicetify.SVGIcons["chart-down"]}
			</svg>
		</button>
		<button class="switch">
			<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">
				${Spicetify.SVGIcons.check}
			</svg>
		</button>
	</div>
</div>
<span>${defaultVal.desc}</span>`;

		if (id === "musixmatch") {
			container.append(musixmatchTokenElements(userConfigs.services.musixmatch));
		}

		const [up, down, slider] = container.querySelectorAll("button");

		slider.classList.toggle("disabled", !defaultVal.on);
		slider.onclick = () => {
			const state = slider.classList.contains("disabled");
			slider.classList.toggle("disabled");
			switchCallback(container, state);
		};

		up.onclick = () => posCallback(container, -1);
		down.onclick = () => posCallback(container, 1);

		return container;
	}

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
		document.removeEventListener("contextmenu", onButtonContextMenu);
		// The topbar button is removed by the registrar's own ctx.defer.
	});
}
