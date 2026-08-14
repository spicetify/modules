/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Bookmark" extension by
 * khanhas. The client's v2-compatible Topbar, ContextMenu, URI, LocalStorage,
 * Player, GraphQL and CosmosAsync helpers still work in v3, so the logic is
 * kept near-verbatim; the presentation uses stdlib's owned right-sidebar panel
 * so Bookmark no longer has to position and dismiss a detached popup.
 */

import { client, createRegistrar, type ModuleRuntimeContext, type PanelController } from "/modules/stdlib/mod.ts";
import { filterBookmarks, idToProperName, largestImage, withNewEntry, withoutEntry } from "./logic.ts";
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
	const { cosmos: CosmosAsync, player: Player, storage: LocalStorage, uri: URI } = client;
	const registrar = createRegistrar(ctx);

	// Tippy instances attached to each card outlive their DOM nodes unless they
	// are explicitly destroyed when the list refreshes or the module unloads.
	const tippyInstances: any[] = [];

	function destroyTippies() {
		for (const instance of tippyInstances) instance?.destroy?.();
		tippyInstances.length = 0;
	}

	class BookmarkCollection {
		container: HTMLElement;
		actions: HTMLElement;
		items: HTMLElement;
		count: HTMLElement;
		lastScroll: number;
		filter: number;

		constructor() {
			const surface = createPanelSurface();
			this.container = surface.container;
			this.actions = surface.actions;
			this.items = surface.items;
			this.count = surface.count;
			this.lastScroll = 0;
			this.filter = 0;
			surface.filter.onchange = (event) => {
				this.filter = (event.target as HTMLSelectElement).selectedIndex;
				this.apply();
			};
		}

		apply() {
			destroyTippies();
			this.actions.replaceChildren(
				createMenuItem("Page", "Bookmark the current page", storeThisPage),
				createMenuItem("Track", "Bookmark the current track", storeTrack),
				createMenuItem("At time", "Bookmark this playback position", storeTrackWithTime),
			);

			const stored = this.getStorage();
			const visible = filterBookmarks(stored, this.filter);
			this.count.textContent = this.filter === 0 ? String(stored.length) : `${visible.length}/${stored.length}`;
			this.items.replaceChildren();
			for (const item of visible) {
				this.items.append(createCard(item));
			}
			if (visible.length === 0) {
				const empty = document.createElement("p");
				empty.className = "bookmark-panel-empty";
				empty.textContent =
					stored.length === 0 ? "Your saved places will appear here." : "No bookmarks match this filter.";
				this.items.append(empty);
			}
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
			LocalStorage.set(STORAGE_KEY, JSON.stringify(withNewEntry(this.getStorage(), data, Date.now())));
			if (this.container.isConnected) this.apply();
		}

		removeFromStorage(id: string) {
			LocalStorage.set(STORAGE_KEY, JSON.stringify(withoutEntry(this.getStorage(), id)));
			this.apply();
		}

		storeScroll() {
			this.lastScroll = this.items.scrollTop;
		}

		setScroll() {
			this.items.scrollTop = this.lastScroll;
		}
	}

	let panelController: PanelController;

	function createCard(info: any): HTMLElement {
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
		const linkButton = document.createElement("button");
		linkButton.type = "button";
		linkButton.className = "bookmark-card-link";
		linkButton.setAttribute("aria-label", `Open ${info.title ?? "bookmark"}`);

		if (info.imageUrl && /^(https:\/\/|data:image\/)/.test(String(info.imageUrl))) {
			const img = document.createElement("img");
			img.className = "bookmark-card-image";
			img.setAttribute("aria-hidden", "false");
			img.draggable = false;
			img.loading = "eager";
			img.src = info.imageUrl;
			img.alt = info.title ?? "";
			linkButton.appendChild(img);
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
		linkButton.appendChild(infoDiv);
		inner.appendChild(linkButton);

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
		removeBtn.innerHTML = `<svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">${client.icons.x}</svg>`;
		inner.appendChild(removeBtn);

		const instances = client.tippy(inner.querySelectorAll("[data-tippy-content]"), client.tippyProps);
		if (Array.isArray(instances)) tippyInstances.push(...instances);
		else if (instances) tippyInstances.push(instances);
		if (isPlayable) {
			const playButton = inner.querySelector("button.main-playButton-PlayButton") as HTMLButtonElement;
			playButton.onclick = (event) => {
				onPlayClick(info);
				event.stopPropagation();
			};
		}

		const controls = inner.querySelector(".bookmark-controls") as HTMLButtonElement;
		controls.onclick = (event) => {
			LIST.removeFromStorage(info.id);
			event.stopPropagation();
		};

		const openBookmark = () => {
			onLinkClick(info);
			panelController.close();
		};
		linkButton.onclick = openBookmark;
		return inner;
	}

	const LIST = new BookmarkCollection();

	const BookmarkPanel = () => {
		const mountRef = React.useRef<HTMLDivElement>(null);
		React.useEffect(() => {
			const mount = mountRef.current;
			if (!mount) return;
			mount.append(LIST.container);
			LIST.apply();
			LIST.setScroll();
			return () => {
				LIST.storeScroll();
				destroyTippies();
				LIST.container.remove();
			};
		}, []);
		return <div className="bookmark-panel-mount" ref={mountRef} />;
	};

	panelController = registrar.registerPanel({
		id: "bookmarks",
		label: "Bookmarks",
		width: { default: 380, min: 320, max: 480 },
		render: () => <BookmarkPanel />,
	});

	registrar.placeButton("topbar-right", {
		label: BUTTON_NAME_TEXT,
		icon: BUTTON_ICON_PATH,
		onClick: () => panelController.toggle(),
	});

	function createMenuItem(title: string, label: string, callback?: () => void) {
		// Plain DOM keeps the panel independent of the client's router contexts.
		const button = document.createElement("button");
		button.type = "button";
		button.className = "bookmark-menu-item";
		button.setAttribute("aria-label", label);
		const span = document.createElement("span");
		span.textContent = title;
		button.appendChild(span);
		button.onclick = () => callback?.();
		return button;
	}

	function createSortSelect() {
		const select = document.createElement("select");
		select.className = "spicetify-select bookmark-filter";
		const allOpt = document.createElement("option");
		allOpt.text = "All";
		const pageOpt = document.createElement("option");
		pageOpt.text = "Pages";
		const trackOpt = document.createElement("option");
		trackOpt.text = "Tracks";

		select.append(allOpt, pageOpt, trackOpt);

		return select;
	}

	async function storeThisPage() {
		let title: string | undefined;
		let description: string;
		let contextUri: any;

		const context = client.platform.History.location.pathname;
		try {
			contextUri = client.uri.fromString(context);
		} catch (e) {
			client.notify("Cannot bookmark this page", true);
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
			client.notify("No track is currently playing", true);
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
		const playerState: any = client.player.data;
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

	function createPanelSurface() {
		const container = document.createElement("div");
		container.className = "bookmark-panel";
		const saveLabel = document.createElement("p");
		saveLabel.className = "bookmark-panel-eyebrow";
		saveLabel.textContent = "Save";
		const actions = document.createElement("div");
		actions.className = "bookmark-panel-actions";
		const saveSection = document.createElement("section");
		saveSection.append(saveLabel, actions);

		const heading = document.createElement("h3");
		heading.textContent = "Saved";
		const count = document.createElement("span");
		count.className = "bookmark-panel-count";
		const filter = createSortSelect();
		const toolbar = document.createElement("header");
		toolbar.className = "bookmark-panel-toolbar";
		toolbar.append(heading, count, filter);
		const items = document.createElement("div");
		items.className = "bookmark-panel-list";
		const library = document.createElement("section");
		library.className = "bookmark-panel-library";
		library.append(toolbar, items);
		container.append(saveSection, library);

		return { container, actions, items, count, filter };
	}

	/**
	 * Handle Link click event when item context is a playlist
	 */
	async function onLinkClick(info: any) {
		if (info.context?.startsWith("/")) {
			client.platform.History.push(info.context);
			return;
		}
		const url = client.uri.fromString(info.uri).toURLPath(true);
		client.platform.History.push(url);
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

		client.player.playUri(uri, {}, options);
	}

	const fetchAlbum = async (uri: string) => {
		const { getAlbum } = client.graphQL.Definitions;
		const { data } = await client.graphQL.Request(getAlbum, {
			uri,
			locale: client.locale.getLocale(),
			offset: 0,
			limit: 10,
		});
		const res = data.albumUnion;
		return {
			uri,
			title: res.name,
			description: "Album",
			imageUrl: largestImage(res.coverArt.sources).url,
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
		const { queryArtistOverview } = client.graphQL.Definitions;
		const { data } = await client.graphQL.Request(queryArtistOverview, {
			uri,
			locale: client.locale.getLocale(),
			includePrerelease: false,
		});
		const res = data.artistUnion;
		return {
			uri,
			title: res.profile.name,
			description: "Artist",
			imageUrl:
				(res.visuals.avatarImage?.sources && largestImage(res.visuals.avatarImage.sources).url) ||
				res.visuals.headerImage?.sources[0].url,
		};
	};

	const fetchTrack = async (uri: string, uid: string, context: string | undefined) => {
		const base62 = uri.split(":")[2];
		const res = await CosmosAsync.get(`https://api.spotify.com/v1/tracks/${base62}`);
		let newContext: string | undefined;
		if (context && uid && client.uri.isPlaylistV1OrV2(context)) {
			newContext = `${client.uri.fromString(context).toURLPath(true)}?uid=${uid}`;
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
		const res = await client.cosmos.get(`sp://core-playlist/v1/playlist/${uri}/metadata`, {
			policy: { picture: true, name: true },
		});
		return {
			uri,
			title: res.metadata.name,
			description: "Playlist",
			imageUrl: res.metadata.picture,
		};
	};

	const contextMenuItem = new client.contextMenu.Item(
		"Bookmark",
		async ([uri], [uid] = [], context = undefined) => {
			const type = uri.split(":")[1];
			let meta: any;
			switch (type) {
				case client.uri.Type.TRACK:
					meta = await fetchTrack(uri, uid, context);
					break;
				case client.uri.Type.ALBUM:
					meta = await fetchAlbum(uri);
					break;
				case client.uri.Type.ARTIST:
					meta = await fetchArtist(uri);
					break;
				case client.uri.Type.SHOW:
					meta = await fetchShow(uri);
					break;
				case client.uri.Type.EPISODE:
					meta = await fetchEpisode(uri);
					break;
				case client.uri.Type.PLAYLIST:
				case client.uri.Type.PLAYLIST_V2:
					meta = await fetchPlaylist(uri);
					break;
			}
			LIST.addToStorage(meta);
		},
		([uri]) => {
			const type = uri.split(":")[1];
			switch (type) {
				case client.uri.Type.TRACK:
				case client.uri.Type.ALBUM:
				case client.uri.Type.ARTIST:
				case client.uri.Type.SHOW:
				case client.uri.Type.EPISODE:
				case client.uri.Type.PLAYLIST:
				case client.uri.Type.PLAYLIST_V2:
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
	});
}
