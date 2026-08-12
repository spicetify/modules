/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Full App Display" extension
 * by khanhas. The client's v2-compatible Topbar, Mousetrap, PopupModal, GraphQL,
 * Player, History and LocalStorage helpers still work in v3, so the logic is kept
 * near-verbatim. The two runtime <style> injections (the overlay stylesheet and
 * the settings-modal stylesheet) were moved into index.scss, and the settings
 * modal is now built as scoped DOM instead of an inline <style> element.
 */

import { client, createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { parseConfig, progressFromPointer, rootClasses, thumbPercent } from "./logic.ts";

// client.mousetrap is a client value whose runtime bind/unbind surface is
// richer than the ambient .d.ts captures. Narrow the member value locally; this
// never casts the Spicetify global itself.
type MousetrapInstance = { bind(keys: string, cb: () => void): void; unbind(keys: string): void };
type MousetrapStatic = {
	new (): MousetrapInstance;
	bind(keys: string, cb: (event: KeyboardEvent) => void): void;
	unbind(keys: string): void;
};

const CONFIG_KEY = "full-app-display-config";

export default async function (ctx: ModuleRuntimeContext) {
	const { react, reactDOM } = client;
	const { useState, useEffect, useRef } = react;
	const Mousetrap = client.mousetrap as unknown as MousetrapStatic;

	function getConfig(): Record<string, any> {
		const parsed = parseConfig(client.storage.get(CONFIG_KEY));
		if (parsed) return parsed;
		client.storage.set(CONFIG_KEY, "{}");
		return {};
	}

	function saveConfig() {
		client.storage.set(CONFIG_KEY, JSON.stringify(CONFIG));
	}

	const CONFIG = getConfig();
	let updateVisual: (() => void) | undefined;
	let fadComponent: any = null;

	function checkLyricsPlus(): boolean {
		return (
			client.config?.custom_apps?.includes("lyrics-plus") || !!document.querySelector("a[href='/lyrics-plus']")
		);
	}

	// The overlay layout is now expressed through classes on the #full-app-display
	// root (see index.scss). Toggling a config option only needs to re-render the
	// mounted component so it recomputes those classes.
	function updateStyle() {
		fadComponent?.forceUpdate();
	}

	const DisplayIcon = ({ icon, size }: any) => {
		return react.createElement("svg", {
			width: size,
			height: size,
			viewBox: "0 0 16 16",
			fill: "currentColor",
			dangerouslySetInnerHTML: {
				__html: icon,
			},
		});
	};

	const SubInfo = ({ text, id, icon }: any) => {
		return react.createElement(
			"div",
			{
				id,
			},
			CONFIG.icons && react.createElement(DisplayIcon, { icon, size: 35 }),
			react.createElement("span", null, text),
		);
	};

	const ButtonIcon = ({ icon, onClick }: any) => {
		return react.createElement(
			"button",
			{
				onClick,
			},
			react.createElement(DisplayIcon, { icon, size: 20 }),
		);
	};

	const ProgressBar = () => {
		const [progress, setProgress] = useState(client.player.getProgress());
		const duration = (client.platform.PlayerAPI as any)._state.duration;

		const progressDivRef = useRef(null);
		const [isDragging, setIsDragging] = useState(false);

		useEffect(() => {
			if (isDragging) {
				return;
			}

			const update = ({ data }: any) => setProgress(data);
			client.player.addEventListener("onprogress", update);
			return () => client.player.removeEventListener("onprogress", update);
		}, [isDragging]);

		// Handle click on progress bar to set progress
		const handleClick = (e: any) => {
			const container = progressDivRef.current;
			if (isDragging || !container) {
				return;
			}

			const containerRect = container.getBoundingClientRect();
			const newProgress = progressFromPointer(e.clientX, containerRect.left, containerRect.width, duration);
			client.player.seek(newProgress);
			setProgress(newProgress);
		};

		// Handle dragging functionality
		const handleMouseDown = () => setIsDragging(true);
		const handleMouseMove = (e: MouseEvent) => {
			const container = progressDivRef.current;
			if (!isDragging || !container) {
				return;
			}

			const containerRect = container.getBoundingClientRect();
			setProgress(progressFromPointer(e.clientX, containerRect.left, containerRect.width, duration));
		};
		const handleMouseUp = () => {
			if (!isDragging) {
				return;
			}

			client.player.seek(progress);
			setIsDragging(false);
		};

		// Attach mousemove and mouseup listeners when dragging starts
		useEffect(() => {
			if (isDragging) {
				window.addEventListener("mousemove", handleMouseMove);
				window.addEventListener("mouseup", handleMouseUp);
			} else {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
			}

			return () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
			};
		}, [isDragging]);

		// Calculate the thumb position
		const thumbPosition = thumbPercent(progress, duration);

		return react.createElement(
			"div",
			{ id: "fad-progress-container" },
			react.createElement("span", { id: "fad-elapsed" }, client.player.formatTime(progress)),
			react.createElement(
				"div",
				{
					id: "fad-progress",
					ref: progressDivRef,
					onClick: handleClick,
					style: {
						"--progress-width": `${thumbPosition}%`,
					},
				},
				react.createElement(
					"div",
					{ id: "fad-progress-inner" },
					react.createElement("div", {
						id: "fad-thumb",
						onMouseDown: handleMouseDown,
					}),
				),
			),
			react.createElement("span", { id: "fad-duration" }, client.player.formatTime(duration)),
		);
	};

	const PlayerControls = () => {
		const [value, setValue] = useState(client.player.isPlaying());
		useEffect(() => {
			const update = ({ data }: any) => setValue(!data.isPaused);
			client.player.addEventListener("onplaypause", update);
			return () => client.player.removeEventListener("onplaypause", update);
		});
		return react.createElement(
			"div",
			{ id: "fad-controls" },
			react.createElement(ButtonIcon, {
				icon: client.icons["skip-back"],
				onClick: client.player.back,
			}),
			react.createElement(ButtonIcon, {
				icon: client.icons[value ? "pause" : "play"],
				onClick: client.player.togglePlay,
			}),
			react.createElement(ButtonIcon, {
				icon: client.icons["skip-forward"],
				onClick: client.player.next,
			}),
		);
	};

	class FAD extends react.Component {
		state: any;
		currTrackImg: HTMLImageElement;
		nextTrackImg: HTMLImageElement;
		mousetrap: MousetrapInstance;
		back: any;
		updateInfo?: () => void;
		onQueueChange?: (queueData: any) => void;
		onScaleChange?: (event: any) => void;

		constructor(props: any) {
			super(props);

			this.state = {
				title: "",
				artist: "",
				album: "",
				releaseDate: "",
				cover: "",
				heart: client.player.getHeart(),
			};
			this.currTrackImg = new Image();
			this.nextTrackImg = new Image();
			this.mousetrap = new Mousetrap();
		}

		async getAlbumDate(uri: string) {
			const { getAlbum } = client.graphQL.Definitions;
			const { errors, data } = await client.graphQL.Request(getAlbum, {
				uri,
				locale: client.locale.getLocale(),
				offset: 0,
				limit: 10,
			});

			if (errors) return null;

			const albumDate = data.albumUnion.date;

			// Avoid false release date (e.g., Jan 1, XXXX)
			if (albumDate.precision === "YEAR") {
				return albumDate.isoString.split("-")[0];
			}

			const date = new Date(albumDate.isoString);

			return date.toLocaleDateString("default", {
				year: "numeric",
				month: "short",
				day: "numeric",
			});
		}

		async fetchInfo() {
			const meta = client.player.data.item.metadata as any;

			// prepare title
			let rawTitle = meta.title;
			if (CONFIG.trimTitle) {
				rawTitle = rawTitle
					.replace(/\(.+?\)/g, "")
					.replace(/\[.+?\]/g, "")
					.replace(/\s-\s.+?$/, "")
					.replace(/,.+?$/, "")
					.trim();
			}

			// prepare artist
			let artistName;
			if (CONFIG.showAllArtists) {
				artistName = Object.keys(meta)
					.filter((key) => key.startsWith("artist_name"))
					.sort()
					.map((key) => meta[key])
					.join(", ");
			} else {
				artistName = meta.artist_name;
			}

			// prepare release date
			let releaseDate;
			if (CONFIG.showReleaseDate) {
				const albumURI = meta.album_uri;
				if (albumURI?.startsWith("spotify:album:")) {
					releaseDate = await this.getAlbumDate(albumURI);
				}
			}

			// prepare album
			const albumText = meta.album_title || "";

			if (meta.image_xlarge_url === this.currTrackImg.src) {
				this.setState({
					title: rawTitle || "",
					artist: artistName || "",
					album: albumText || "",
					releaseDate: releaseDate || "",
					heart: client.player.getHeart(),
				});
				return;
			}

			// TODO: Pre-load next track
			// Wait until next track image is downloaded then update UI text and images
			const previousImg = this.currTrackImg.cloneNode() as HTMLImageElement;
			this.currTrackImg.src = meta.image_xlarge_url;
			this.currTrackImg.onload = () => {
				const bgImage = `url("${this.currTrackImg.src}")`;

				this.animateCanvas(previousImg, this.currTrackImg);
				this.setState({
					title: rawTitle || "",
					artist: artistName || "",
					album: albumText || "",
					releaseDate: releaseDate || "",
					cover: bgImage,
					heart: client.player.getHeart(),
				});
			};
			this.currTrackImg.onerror = () => {
				// Placeholder
				this.currTrackImg.src =
					"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCI+CiAgPHJlY3Qgc3R5bGU9ImZpbGw6I2ZmZmZmZiIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiB4PSIwIiB5PSIwIiAvPgogIDxwYXRoIGZpbGw9IiNCM0IzQjMiIGQ9Ik0yNi4yNSAxNi4xNjJMMjEuMDA1IDEzLjEzNEwyMS4wMTIgMjIuNTA2QzIwLjU5NCAyMi4xOTIgMjAuMDgxIDIxLjk5OSAxOS41MTkgMjEuOTk5QzE4LjE0MSAyMS45OTkgMTcuMDE5IDIzLjEyMSAxNy4wMTkgMjQuNDk5QzE3LjAxOSAyNS44NzggMTguMTQxIDI2Ljk5OSAxOS41MTkgMjYuOTk5QzIwLjg5NyAyNi45OTkgMjIuMDE5IDI1Ljg3OCAyMi4wMTkgMjQuNDk5QzIyLjAxOSAyNC40MjIgMjIuMDA2IDE0Ljg2NyAyMi4wMDYgMTQuODY3TDI1Ljc1IDE3LjAyOUwyNi4yNSAxNi4xNjJaTTE5LjUxOSAyNS45OThDMTguNjkyIDI1Ljk5OCAxOC4wMTkgMjUuMzI1IDE4LjAxOSAyNC40OThDMTguMDE5IDIzLjY3MSAxOC42OTIgMjIuOTk4IDE5LjUxOSAyMi45OThDMjAuMzQ2IDIyLjk5OCAyMS4wMTkgMjMuNjcxIDIxLjAxOSAyNC40OThDMjEuMDE5IDI1LjMyNSAyMC4zNDYgMjUuOTk4IDE5LjUxOSAyNS45OThaIi8+Cjwvc3ZnPgo=";
			};
		}

		animateCanvas(prevImg: HTMLImageElement, nextImg: HTMLImageElement) {
			const { innerWidth: width, innerHeight: height } = window;
			this.back.width = width;
			this.back.height = height;

			const ctx = this.back.getContext("2d");
			ctx.imageSmoothingEnabled = false;
			ctx.filter = "blur(30px) brightness(0.6)";
			const blur = 30;

			const x = -blur * 2;

			let y;
			let dim;

			if (width > height) {
				dim = width;
				y = x - (width - height) / 2;
			} else {
				dim = height;
				y = x;
			}

			const size = dim + 4 * blur;

			if (!CONFIG.enableFade) {
				ctx.globalAlpha = 1;
				ctx.drawImage(nextImg, x, y, size, size);
				return;
			}

			let factor = 0.0;
			const animate = () => {
				ctx.globalAlpha = 1;
				ctx.drawImage(prevImg, x, y, size, size);
				ctx.globalAlpha = Math.sin((Math.PI / 2) * factor);
				ctx.drawImage(nextImg, x, y, size, size);

				if (factor < 1.0) {
					factor += 0.016;
					requestAnimationFrame(animate);
				}
			};

			requestAnimationFrame(animate);
		}

		componentDidMount() {
			fadComponent = this;

			this.updateInfo = this.fetchInfo.bind(this);
			client.player.addEventListener("songchange", this.updateInfo);
			this.updateInfo();

			updateVisual = () => {
				updateStyle();
				this.fetchInfo();
			};

			this.onQueueChange = async (queueData: any) => {
				const queue = queueData.data;
				let nextTrack;
				if (queue.queued.length) {
					nextTrack = queue.queued[0];
				} else {
					nextTrack = queue.nextUp[0];
				}
				this.nextTrackImg.src = nextTrack.metadata.image_xlarge_url;
			};

			const scaleLimit = { min: 0.1, max: 4, step: 0.05 };
			this.onScaleChange = (event: any) => {
				if (!event.ctrlKey) return;
				const dir = event.deltaY < 0 ? 1 : -1;
				let temp = (CONFIG.scale || 1) + dir * scaleLimit.step;
				if (temp < scaleLimit.min) {
					temp = scaleLimit.min;
				} else if (temp > scaleLimit.max) {
					temp = scaleLimit.max;
				}
				CONFIG.scale = temp;
				saveConfig();
				updateVisual?.();
			};

			(client.platform.PlayerAPI as any)._events.addListener("queue_update", this.onQueueChange);
			this.mousetrap.bind("esc", deactivate);
			window.dispatchEvent(new Event("fad-request"));
		}

		componentWillUnmount() {
			if (this.updateInfo) client.player.removeEventListener("songchange", this.updateInfo);
			(client.platform.PlayerAPI as any)._events.removeListener("queue_update", this.onQueueChange);
			this.mousetrap.unbind("esc");
			updateVisual = undefined;
			fadComponent = null;
		}

		render() {
			const rootClass = rootClasses(CONFIG, checkLyricsPlus());

			return react.createElement(
				"div",
				{
					id: "full-app-display",
					className: rootClass,
					onDoubleClick: deactivate,
					onContextMenu: openConfig,
				},
				react.createElement("canvas", {
					id: "fad-background",
					ref: (el: any) => {
						this.back = el;
					},
				}),
				react.createElement("div", { id: "fad-header" }),
				react.createElement(
					"div",
					{ id: "fad-body" },
					react.createElement(
						"div",
						{
							id: "fad-foreground",
							style: {
								"--fad-scale": CONFIG.scale || 1,
							},
							ref: (el: any) => {
								if (!el) return;
								el.onmousewheel = this.onScaleChange;
							},
						},
						react.createElement(
							"div",
							{ id: "fad-art" },
							react.createElement(
								"div",
								{
									id: "fad-art-image",
									className: CONFIG.enableFade && "fad-background-fade",
									style: {
										backgroundImage: this.state.cover,
									},
								},
								react.createElement(
									"div",
									{
										id: "fad-art-overlay",
									},
									react.createElement(
										"button",
										{
											id: "fad-heart",
											onClick: () => {
												client.player.toggleHeart();
												this.setState({ heart: !this.state.heart });
											},
										},
										react.createElement(DisplayIcon, {
											icon: client.icons[this.state.heart ? "heart-active" : "heart"],
											size: 50,
										}),
									),
								),
								react.createElement("div", {
									id: "fad-art-inner",
								}),
							),
						),
						react.createElement(
							"div",
							{ id: "fad-details" },
							react.createElement("div", { id: "fad-title" }, this.state.title),
							react.createElement(SubInfo, {
								id: "fad-artist",
								text: this.state.artist,
								icon: client.icons.artist,
							}),
							CONFIG.showAlbum &&
								react.createElement(SubInfo, {
									id: "fad-album",
									text: this.state.album,
									icon: client.icons.album,
								}),
							CONFIG.showReleaseDate &&
								react.createElement(SubInfo, {
									id: "fad-release-date",
									text: this.state.releaseDate,
									icon: client.icons.clock,
								}),
							react.createElement(
								"div",
								{
									id: "fad-status",
									className: (CONFIG.enableControl || CONFIG.enableProgress) && "active",
								},
								CONFIG.enableControl && react.createElement(PlayerControls),
								CONFIG.enableProgress && react.createElement(ProgressBar),
							),
						),
					),
					CONFIG.lyricsPlus &&
						react.createElement("div", {
							id: "fad-lyrics-plus-container",
							style: {
								"--lyrics-color-active": "#ffffff",
								"--lyrics-color-inactive": "#ffffff50",
							},
						}),
				),
			);
		}
	}

	const classes = ["video", "video-full-screen", "video-full-window", "video-full-screen--hide-ui", "fad-activated"];

	const container = document.createElement("div");
	container.id = "fad-main";
	let lastApp: string | undefined;
	let cursorTimeout: ReturnType<typeof setTimeout> | undefined;
	let fad: HTMLElement | null;

	async function toggleFullscreen() {
		if (CONFIG.enableFullscreen) {
			await document.documentElement.requestFullscreen();
			toggleCursor(false);
		} else if ((document as any).webkitIsFullScreen) {
			await document.exitFullscreen();
			toggleCursor(true);
		}
	}

	function eventListener() {
		showCursor();
		cursorTimeout = setTimeout(hideCursor, 2000);
	}

	function showCursor() {
		fad?.classList.remove("hide-cursor");
		clearTimeout(cursorTimeout);
	}

	function hideCursor() {
		fad?.classList.add("hide-cursor");
	}

	function toggleCursor(show = true) {
		fad = document.getElementById("full-app-display");

		if (!fad) {
			// Track the retry in cursorTimeout so ctx.defer's clearTimeout can
			// cancel an in-flight retry during teardown.
			cursorTimeout = setTimeout(toggleCursor, 300, show);
			return;
		}

		if (show) {
			document.removeEventListener("mousemove", eventListener);
			showCursor();
		} else {
			cursorTimeout = setTimeout(hideCursor, 2000);
			document.addEventListener("mousemove", eventListener);
		}
	}

	async function activate() {
		if (!client.player.data) return;

		await toggleFullscreen();

		document.body.classList.add(...classes);
		document.body.append(container);
		reactDOM.render(react.createElement(FAD), container);

		requestLyricsPlus();
	}

	function deactivate() {
		if (CONFIG.enableFullscreen || (document as any).webkitIsFullScreen) {
			document.exitFullscreen();
		}
		toggleCursor(true);
		document.body.classList.remove(...classes);
		reactDOM.unmountComponentAtNode(container);
		container.remove();
		window.dispatchEvent(new Event("fad-request"));

		if (lastApp && lastApp !== "/lyrics-plus") {
			client.platform.History.push(lastApp);
		}
	}

	function toggleFad() {
		if (document.body.classList.contains("fad-activated")) {
			deactivate();
		} else {
			activate();
		}
	}

	function requestLyricsPlus() {
		if (CONFIG.lyricsPlus && checkLyricsPlus()) {
			lastApp = client.platform.History.location.pathname;
			if (lastApp !== "/lyrics-plus") {
				client.platform.History.push("/lyrics-plus");
			}
		}
		window.dispatchEvent(new Event("fad-request"));
	}

	// Settings modal, opened by right-clicking the overlay. Built as scoped DOM;
	// its styles live in index.scss under .full-app-display-settings.
	function buildConfig(): HTMLElement {
		const content = document.createElement("div");
		content.className = "full-app-display-settings";

		const addSlider = (name: string, field: string, func: () => void, disabled = false) => {
			const row = document.createElement("div");
			row.className = "setting-row";

			const label = document.createElement("label");
			label.className = "col description";
			label.textContent = name;

			const action = document.createElement("div");
			action.className = "col action";

			const btn = document.createElement("button");
			btn.className = "switch";
			btn.disabled = disabled;
			btn.innerHTML = `<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">${client.icons.check}</svg>`;
			btn.classList.toggle("disabled", !CONFIG[field]);
			btn.onclick = () => {
				const state = !CONFIG[field];
				CONFIG[field] = state;
				btn.classList.toggle("disabled", !state);
				saveConfig();
				func();
			};

			action.appendChild(btn);
			row.append(label, action);
			content.appendChild(row);
		};

		addSlider(
			checkLyricsPlus() ? "Enable Lyrics Plus integration" : "Lyrics Plus not applied",
			"lyricsPlus",
			() => {
				updateVisual?.();
				requestLyricsPlus();
			},
			!checkLyricsPlus(),
		);
		addSlider("Enable progress bar", "enableProgress", () => updateVisual?.());
		addSlider("Enable controls", "enableControl", () => updateVisual?.());
		addSlider("Trim title", "trimTitle", () => updateVisual?.());
		addSlider("Show album", "showAlbum", () => updateVisual?.());
		addSlider("Show all artists", "showAllArtists", () => updateVisual?.());
		addSlider("Show release date", "showReleaseDate", () => updateVisual?.());
		addSlider("Show icons", "icons", () => updateVisual?.());
		addSlider("Vertical mode", "vertical", () => updateStyle());
		addSlider("Enable fullscreen", "enableFullscreen", () => void toggleFullscreen());
		addSlider("Enable song change animation", "enableFade", () => updateVisual?.());

		return content;
	}

	function openConfig(event: MouseEvent) {
		event.preventDefault();
		client.popupModal.display({
			title: "Full App Display",
			content: buildConfig(),
		});
	}

	// Add activator on top bar. placeButton mounts through the stdlib
	// topbar-right register (the classic wrapper Topbar.Button no longer
	// mounts in v3's restructured top bar) and is torn down with the module.
	const registrar = createRegistrar(ctx);
	// 1.5 round stroke matches the native encore topbar icons (the classic
	// SVGIcons.projector is a heavier vintage and stands out next to them).
	registrar.placeButton("topbar-right", {
		label: "Full App Display",
		icon: '<rect fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" x="0.9" y="3.75" width="14.2" height="7.5" rx="1.1"/><circle fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" cx="11.5" cy="7.5" r="1.5"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M3.1 11.6v1.9M12.9 11.6v1.9"/>',
		onClick: activate,
	});

	Mousetrap.bind("f11", toggleFad);

	// ----- teardown -----
	ctx.defer(() => {
		if (document.body.classList.contains("fad-activated")) {
			deactivate();
		}
		Mousetrap.unbind("f11");
		document.removeEventListener("mousemove", eventListener);
		clearTimeout(cursorTimeout);
		// The topbar button is removed by the registrar's own ctx.defer.
	});
}
