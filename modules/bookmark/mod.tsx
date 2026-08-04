/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Bookmark" extension by
 * khanhas. The client's v2-compatible Topbar, ContextMenu, URI, LocalStorage,
 * Player, GraphQL and CosmosAsync helpers still work in v3, so the logic is
 * kept near-verbatim; only the runtime <style> injection moves to index.scss
 * and the custom element is expressed as a plain DOM factory (a fixed custom
 * element name cannot be re-registered on module reload).
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";

// UI Text
const BUTTON_NAME_TEXT = "Bookmark";
const REMOVE_TEXT = "Remove";

// Local Storage keys (kept verbatim from v2 for continuity)
const STORAGE_KEY = "bookmark_spicetify";

// The register's icon slot fills an <svg> host with this inner markup, so it
// needs the bare path; the ContextMenu.Item takes a full standalone <svg>.
// Drawn as a 1.5 round stroke: the native encore icons (bell, friends) are
// 1.5-unit outlines on the 16 grid, so module icons match their weight.
const BUTTON_ICON_PATH =
	'<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M3.1 1.15h9.8v13.4L8 10.2l-4.9 4.35z"></path>';
const BUTTON_ICON = `<svg role="img" height="16" width="16" viewBox="0 0 16 16" fill="currentColor">${BUTTON_ICON_PATH}</svg>`;

export default async function (ctx: ModuleRuntimeContext) {
	const { CosmosAsync, Player, LocalStorage, URI } = Spicetify;
	const registrar = createRegistrar(ctx);

	// The popup is rebuilt from scratch on every apply(); the React roots behind
	// the MenuItem entries and the Tippy instances attached to each card outlive
	// the DOM nodes unless we tear them down explicitly, so we track them.
	const menuItemWrappers: HTMLElement[] = [];
	const tippyInstances: any[] = [];

	function disposeMenuItems() {
		for (const wrapper of menuItemWrappers) Spicetify.ReactDOM.unmountComponentAtNode(wrapper);
		menuItemWrappers.length = 0;
	}

	function destroyTippies() {
		for (const instance of tippyInstances) instance?.destroy?.();
		tippyInstances.length = 0;
	}

	class BookmarkCollection {
		container: HTMLElement;
		items: HTMLElement;
		lastScroll: number;
		filter: number;

		// ESC listener is only attached while the menu is open.
		private onKey?: (e: KeyboardEvent) => void;

		constructor() {
			const menu = createMenu();
			this.container = menu.container;
			this.items = menu.menu;
			this.lastScroll = 0;
			this.filter = 0;
			// Dismiss on the backdrop's click, not mousedown: the client
			// swallows mousedown in the window capture phase (keydown is
			// unaffected, which is why Escape worked but a mousedown dismiss
			// did not). The menu stops its own clicks from bubbling here.
			this.container.addEventListener("click", () => this.close());
			this.apply();
		}

		// Called by openBookmarks after the menu is in the DOM.
		open() {
			this.onKey = (e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					this.close();
				}
			};
			document.addEventListener("keydown", this.onKey, true);
		}

		close() {
			this.storeScroll();
			if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
			this.onKey = undefined;
			this.container.remove();
		}

		apply() {
			destroyTippies();
			disposeMenuItems();
			this.items.textContent = ""; // Remove all childs
			this.items.append(createMenuItem("Current page", storeThisPage));
			this.items.append(createMenuItem("Track", storeTrack));
			this.items.append(createMenuItem("Track with timestamp", storeTrackWithTime));

			const select = createSortSelect(this.filter);
			select.onchange = (event) => {
				this.filter = (event.target as HTMLSelectElement).selectedIndex;
				this.apply();
			};
			this.items.append(select);

			const collection = this.getStorage();
			for (const item of collection) {
				if (this.filter !== 0) {
					const isTrack = this.isTrack(item.uri);
					if (this.filter === 1 && isTrack) continue;
					if (this.filter === 2 && !isTrack) continue;
				}

				this.items.append(createCard(item));
			}
		}

		isTrack(uri: string) {
			return uri.startsWith("spotify:track:") || uri.startsWith("spotify:episode:");
		}

		getStorage(): any[] {
			const storageRaw = LocalStorage.get(STORAGE_KEY);
			let storage: any[] = [];

			if (storageRaw) {
				storage = JSON.parse(storageRaw);
			} else {
				LocalStorage.set(STORAGE_KEY, "[]");
			}

			return storage;
		}

		addToStorage(data: any) {
			data.id = `${data.uri}-${new Date().getTime()}`;

			const storage = this.getStorage();
			storage.unshift(data);

			LocalStorage.set(STORAGE_KEY, JSON.stringify(storage));
			this.apply();
		}

		removeFromStorage(id: string) {
			const storage = this.getStorage().filter((item) => item.id !== id);

			LocalStorage.set(STORAGE_KEY, JSON.stringify(storage));
			this.apply();
		}

		changePosition(x: number, y: number) {
			// Clamp into the viewport: a right-side topbar button would push a
			// left-aligned menu off the right edge.
			const margin = 8;
			const width = this.items.offsetWidth || 360;
			const height = this.items.offsetHeight || 0;
			const left = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
			const top = Math.max(margin, Math.min(y + 40, window.innerHeight - height - margin));
			this.items.style.left = `${left}px`;
			this.items.style.top = `${top}px`;
		}

		storeScroll() {
			this.lastScroll = this.items.scrollTop;
		}

		setScroll() {
			this.items.scrollTop = this.lastScroll;
		}
	}

	function createCard(info: any): HTMLElement {
		const card = document.createElement("div");
		const uri = URI.fromString(info.uri);
		const isPlayable =
			uri.type === URI.Type.TRACK ||
			uri.type === URI.Type.PLAYLIST_V2 ||
			uri.type === URI.Type.ALBUM ||
			uri.type === URI.Type.EPISODE ||
			uri.type === URI.Type.PLAYLIST;

		// Built with DOM APIs and textContent: track/album/page titles and
		// descriptions are attacker-controllable (anyone can name a playlist), so
		// they must never reach innerHTML. innerHTML is used only for the trusted
		// static play glyph and the client's own SVGIcons constant.
		const inner = document.createElement("div");
		inner.className = "bookmark-card";

		if (info.imageUrl && /^(https:\/\/|data:image\/)/.test(String(info.imageUrl))) {
			const img = document.createElement("img");
			img.className = "bookmark-card-image";
			img.setAttribute("aria-hidden", "false");
			img.draggable = false;
			img.loading = "eager";
			img.src = info.imageUrl;
			img.alt = info.title ?? "";
			inner.appendChild(img);
		}

		const infoDiv = document.createElement("div");
		infoDiv.className = "bookmark-card-info";
		const titleDiv = document.createElement("div");
		titleDiv.className = "main-type-balladBold";
		const titleSpan = document.createElement("span");
		titleSpan.textContent = info.title ?? "";
		titleDiv.appendChild(titleSpan);
		const descDiv = document.createElement("div");
		descDiv.className = "main-type-mesto";
		const descSpan = document.createElement("span");
		descSpan.textContent = info.description ?? "";
		descDiv.appendChild(descSpan);
		infoDiv.append(titleDiv, descDiv);

		if (info.time) {
			const fixed = document.createElement("div");
			fixed.className = "bookmark-fixed-height";
			const prog = document.createElement("div");
			prog.className = "bookmark-progress";
			const progBar = document.createElement("div");
			progBar.className = "bookmark-progress__bar";
			progBar.style.setProperty("--progress", String(info.progress ?? 0));
			prog.appendChild(progBar);
			const timeSpan = document.createElement("span");
			timeSpan.className = "bookmark-progress__time main-type-mesto";
			timeSpan.textContent = Player.formatTime(info.time);
			fixed.append(prog, timeSpan);
			infoDiv.appendChild(fixed);
		}
		inner.appendChild(infoDiv);

		if (isPlayable) {
			const playWrap = document.createElement("div");
			playWrap.className = "ButtonInner-md-iconOnly";
			// Static, trusted markup (no user-controlled data).
			playWrap.innerHTML =
				'<button class="main-playButton-PlayButton main-playButton-primary" data-tippy-content="Play" style="--size:48px;"><svg role="img" height="24" width="24" viewBox="0 0 16 16" fill="currentColor"><path d="M4.018 14L14.41 8 4.018 2z"></path></svg></button>';
			inner.appendChild(playWrap);
		}

		const removeBtn = document.createElement("button");
		removeBtn.className = "bookmark-controls";
		removeBtn.setAttribute("data-tippy-content", REMOVE_TEXT);
		// SVGIcons.x is a trusted client constant.
		removeBtn.innerHTML = `<svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons.x}</svg>`;
		inner.appendChild(removeBtn);

		card.appendChild(inner);

		const instances = Spicetify.Tippy(card.querySelectorAll("[data-tippy-content]"), Spicetify.TippyProps);
		if (Array.isArray(instances)) tippyInstances.push(...instances);
		else if (instances) tippyInstances.push(instances);
		if (isPlayable) {
			const playButton = card.querySelector("button.main-playButton-PlayButton") as HTMLButtonElement;
			playButton.onclick = (event) => {
				onPlayClick(info);
				event.stopPropagation();
			};
		}

		const controls = card.querySelector(".bookmark-controls") as HTMLButtonElement;
		controls.onclick = (event) => {
			LIST.removeFromStorage(info.id);
			event.stopPropagation();
		};

		card.onclick = () => {
			onLinkClick(info);
			LIST.close();
		};
		return card;
	}

	const LIST = new BookmarkCollection();

	// The classic Spicetify.Topbar.Button no longer mounts in v3's restructured
	// topbar (same reason trashbin abandoned Playbar.Widget), so the entry point
	// goes through registrar.placeButton("topbar-right", ...). placeButton gives
	// no element handle, so the popup is positioned off the mounted button looked
	// up by its aria-label within the register's anchor.
	function openBookmarks() {
		const button = document.querySelector<HTMLElement>(
			`.spicetify-topbar-right-buttons [aria-label="${BUTTON_NAME_TEXT}"]`,
		);
		const bound = button?.getBoundingClientRect();
		// Append before positioning so changePosition can measure the menu.
		document.body.append(LIST.container);
		if (bound) LIST.changePosition(bound.left, bound.top);
		LIST.setScroll();
		LIST.open();
	}

	registrar.placeButton("topbar-right", {
		label: BUTTON_NAME_TEXT,
		icon: BUTTON_ICON_PATH,
		onClick: openBookmarks,
	});

	function createMenuItem(title: string, callback?: () => void) {
		// Plain DOM styled with the native context-menu-item class. The client's
		// ReactComponent.MenuItem uses useNavigateStable and can only render
		// inside the app router, so rendering it into this detached popup throws.
		const button = document.createElement("button");
		button.type = "button";
		button.className = "main-contextMenu-menuItemButton bookmark-menu-item";
		const span = document.createElement("span");
		span.textContent = title;
		button.appendChild(span);
		button.onclick = () => callback?.();
		return button;
	}

	function createSortSelect(defaultOpt = 0) {
		const select = document.createElement("select");
		select.className = "spicetify-select bookmark-filter";
		const allOpt = document.createElement("option");
		allOpt.text = "All";
		const pageOpt = document.createElement("option");
		pageOpt.text = "Page";
		const trackOpt = document.createElement("option");
		trackOpt.text = "Track";

		select.onclick = (ev) => ev.stopPropagation();
		select.append(allOpt, pageOpt, trackOpt);
		select.options[defaultOpt].selected = true;

		return select;
	}

	async function storeThisPage() {
		let title: string | undefined;
		let description: string;
		let contextUri: any;

		const context = Spicetify.Platform.History.location.pathname;
		try {
			contextUri = Spicetify.URI.fromString(context);
		} catch (e) {
			Spicetify.showNotification("Cannot bookmark this page", true);
			return;
		}
		const uri = contextUri.toURI();

		const titleElem =
			document.querySelector(".Root__main-view h1") ||
			document.querySelector(".Root__main-view h2") ||
			document.querySelector(".Root__main-view h3") ||
			document.querySelector(".Root__main-view a");

		if (titleElem) {
			title = (titleElem as HTMLElement).innerText;
		}

		if (!title && contextUri.type === URI.Type.APPLICATION) {
			title = idToProperName(contextUri.id);
			description = "Application";
		} else {
			description = contextUri.type.replace(/-.+$/, "");
			const tail = context.split("/");
			if (tail.length > 3) {
				description += ` ${tail[3]}`;
			}
			description = idToProperName(description);
		}

		const headerElem = document.querySelector(
			".Root__main-view .main-entityHeader-background",
		) as HTMLElement | null;
		let imageUrl = headerElem?.style.backgroundImage.replace('url("', "").replace('")', "");

		if (!imageUrl) {
			const firstImgElem = document.querySelector(".Root__main-view img") as HTMLImageElement | null;
			imageUrl = firstImgElem?.src;
		}

		LIST.addToStorage({
			uri,
			title,
			description,
			imageUrl,
			context,
		});
	}

	function getTrackMeta() {
		const item = Player.data?.item;
		if (!item?.uri) {
			Spicetify.showNotification("No track is currently playing", true);
			return null;
		}
		const meta: any = {
			title: item.metadata?.title,
			imageUrl: item.metadata?.image_url,
		};
		meta.uri = item.uri;
		if (URI.isEpisode(meta.uri)) {
			meta.description = item.metadata?.album_title;
		} else {
			meta.description = item.metadata?.artist_name;
		}
		const playerState: any = Spicetify.Player.data;
		const rawContextUri = playerState.context_uri ?? playerState.context?.uri;
		const contextUri = rawContextUri ? URI.fromString(rawContextUri) : undefined;
		if (
			contextUri &&
			(contextUri.type === URI.Type.PLAYLIST ||
				contextUri.type === URI.Type.PLAYLIST_V2 ||
				contextUri.type === URI.Type.ALBUM)
		) {
			meta.context = `/${contextUri.toURLPath(false)}?uid=${(item as any).uid}`;
		}

		return meta;
	}

	function storeTrack() {
		const meta = getTrackMeta();
		if (meta) LIST.addToStorage(meta);
	}

	function storeTrackWithTime() {
		const meta = getTrackMeta();
		if (!meta) return;
		meta.time = Player.getProgress();
		meta.progress = Player.getProgressPercent();
		LIST.addToStorage(meta);
	}

	// Utilities
	function idToProperName(id: string) {
		const newId = id.replace(/-/g, " ").replace(/^.|\s./g, (char) => char.toUpperCase());

		return newId;
	}

	function createMenu() {
		const container = document.createElement("div");
		container.id = "bookmark-spicetify";
		container.className = "context-menu-container";

		const menu = document.createElement("ul");
		menu.id = "bookmark-menu";
		menu.className = "main-contextMenu-menu";
		menu.onclick = (e) => e.stopPropagation();

		container.append(menu);

		return { container, menu };
	}

	/**
	 * Handle Link click event when item context is a playlist
	 */
	async function onLinkClick(info: any) {
		if (info.context?.startsWith("/")) {
			Spicetify.Platform.History.push(info.context);
			return;
		}
		const url = Spicetify.URI.fromString(info.uri).toURLPath(true);
		Spicetify.Platform.History.push(url);
	}

	function onPlayClick(info: any) {
		let uri = info.uri;
		const options: any = {};
		if (info.time) {
			options.seekTo = info.time;
		}
		if (info.context?.startsWith("/")) {
			uri = URI.fromString(info.context).toURI();
			if (uri !== info.uri) {
				options.skipTo = {};
				options.skipTo.uid = info.context.split("?uid=", 2)[1];
				options.skipTo.uri = info.uri;
			}
		}

		Spicetify.Player.playUri(uri, {}, options);
	}

	const fetchAlbum = async (uri: string) => {
		const { getAlbum } = Spicetify.GraphQL.Definitions;
		const { data } = await Spicetify.GraphQL.Request(getAlbum, {
			uri,
			locale: Spicetify.Locale.getLocale(),
			offset: 0,
			limit: 10,
		});
		const res = data.albumUnion;
		return {
			uri,
			title: res.name,
			description: "Album",
			imageUrl: res.coverArt.sources.reduce((prev: any, curr: any) => (prev.width > curr.width ? prev : curr))
				.url,
		};
	};

	const fetchShow = async (uri: string) => {
		const base62 = uri.split(":")[2];
		const res = await CosmosAsync.get(`sp://core-show/v1/shows/${base62}?responseFormat=protobufJson`, {
			policy: { list: { index: true } },
		});
		return {
			uri,
			title: res.header.showMetadata.name,
			description: "Podcast",
			imageUrl: res.header.showMetadata.covers.standardLink,
		};
	};

	const fetchArtist = async (uri: string) => {
		const { queryArtistOverview } = Spicetify.GraphQL.Definitions;
		const { data } = await Spicetify.GraphQL.Request(queryArtistOverview, {
			uri,
			locale: Spicetify.Locale.getLocale(),
			includePrerelease: false,
		});
		const res = data.artistUnion;
		return {
			uri,
			title: res.profile.name,
			description: "Artist",
			imageUrl:
				res.visuals.avatarImage?.sources.reduce((prev: any, curr: any) =>
					prev.width > curr.width ? prev : curr,
				).url || res.visuals.headerImage?.sources[0].url,
		};
	};

	const fetchTrack = async (uri: string, uid: string, context: string | undefined) => {
		const base62 = uri.split(":")[2];
		const res = await CosmosAsync.get(`https://api.spotify.com/v1/tracks/${base62}`);
		let newContext: string | undefined;
		if (context && uid && Spicetify.URI.isPlaylistV1OrV2(context)) {
			newContext = `${Spicetify.URI.fromString(context).toURLPath(true)}?uid=${uid}`;
		}
		return {
			uri,
			title: res.name,
			description: res.artists[0].name,
			imageUrl: res.album.images[0].url,
			context: newContext ?? context,
		};
	};

	const fetchEpisode = async (uri: string) => {
		const base62 = uri.split(":")[2];
		const res = await CosmosAsync.get(`https://api.spotify.com/v1/episodes/${base62}`);
		return {
			uri,
			title: res.name,
			description: `${res.show.name} episode`,
			imageUrl: res.show.images[0].url,
		};
	};

	const fetchPlaylist = async (uri: string) => {
		const res = await Spicetify.CosmosAsync.get(`sp://core-playlist/v1/playlist/${uri}/metadata`, {
			policy: { picture: true, name: true },
		});
		return {
			uri,
			title: res.metadata.name,
			description: "Playlist",
			imageUrl: res.metadata.picture,
		};
	};

	const contextMenuItem = new Spicetify.ContextMenu.Item(
		"Bookmark",
		async ([uri], [uid] = [], context = undefined) => {
			const type = uri.split(":")[1];
			let meta: any;
			switch (type) {
				case Spicetify.URI.Type.TRACK:
					meta = await fetchTrack(uri, uid, context);
					break;
				case Spicetify.URI.Type.ALBUM:
					meta = await fetchAlbum(uri);
					break;
				case Spicetify.URI.Type.ARTIST:
					meta = await fetchArtist(uri);
					break;
				case Spicetify.URI.Type.SHOW:
					meta = await fetchShow(uri);
					break;
				case Spicetify.URI.Type.EPISODE:
					meta = await fetchEpisode(uri);
					break;
				case Spicetify.URI.Type.PLAYLIST:
				case Spicetify.URI.Type.PLAYLIST_V2:
					meta = await fetchPlaylist(uri);
					break;
			}
			LIST.addToStorage(meta);
		},
		([uri]) => {
			const type = uri.split(":")[1];
			switch (type) {
				case Spicetify.URI.Type.TRACK:
				case Spicetify.URI.Type.ALBUM:
				case Spicetify.URI.Type.ARTIST:
				case Spicetify.URI.Type.SHOW:
				case Spicetify.URI.Type.EPISODE:
				case Spicetify.URI.Type.PLAYLIST:
				case Spicetify.URI.Type.PLAYLIST_V2:
					return true;
			}
			return false;
		},
		BUTTON_ICON,
	);
	contextMenuItem.register();

	// ----- teardown -----
	// The topbar button is torn down automatically by the registrar's own
	// ctx.defer (via createRegistrar); here we only clean up what it doesn't own.
	ctx.defer(() => {
		contextMenuItem.deregister();
		destroyTippies();
		disposeMenuItems();
		LIST.close();
	});
}
