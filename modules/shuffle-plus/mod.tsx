/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Shuffle+" extension by
 * khanhas and Tetrax-10. The client's v2-compatible Menu, ContextMenu, Playbar,
 * URI, GraphQL, CosmosAsync, Platform and LocalStorage helpers all still work in
 * v3, so the logic is kept near-verbatim; only the settings modal's injected
 * <style> tag moves into index.scss (scoped under .shuffle-plus-settings).
 */

import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

import { buildNextTracks, matchesArtistFilter, parseStoredConfig, searchFolder, shuffle } from "./logic.ts";

export default async function (ctx: ModuleRuntimeContext) {
	const { React } = Spicetify;
	const { useState } = React;
	const { Type } = Spicetify.URI;

	let playbarButton: any = null;

	function getConfig(): any {
		const parsed = parseStoredConfig(Spicetify.LocalStorage.get("shufflePlus:settings"));
		if (parsed) return parsed;
		Spicetify.LocalStorage.set("shufflePlus:settings", "{}");
		return {
			artistMode: "all",
			artistNameMust: false,
			enableQueueButton: false,
		};
	}

	const CONFIG = getConfig();
	saveConfig();

	function saveConfig() {
		Spicetify.LocalStorage.set("shufflePlus:settings", JSON.stringify(CONFIG));
	}

	function settingsPage() {
		function DisplayIcon({ icon, size }: { icon: string; size: number }) {
			return React.createElement("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "currentColor",
				dangerouslySetInnerHTML: {
					__html: icon,
				},
			});
		}

		function checkBoxItem({
			name,
			field,
			onclickFun = () => {},
		}: {
			name: string;
			field: string;
			onclickFun?: () => void;
		}) {
			const [value, setValue] = useState(CONFIG[field]);
			return React.createElement(
				"div",
				{ className: "popup-row" },
				React.createElement("label", { className: "col description" }, name),
				React.createElement(
					"div",
					{ className: "col action" },
					React.createElement(
						"button",
						{
							className: `checkbox${value ? "" : " disabled"}`,
							onClick: () => {
								CONFIG[field] = !value;
								setValue(!value);
								saveConfig();
								onclickFun();
							},
						},
						React.createElement(DisplayIcon, {
							icon: Spicetify.SVGIcons.check,
							size: 16,
						}),
					),
				),
			);
		}

		function dropDownItem({
			name,
			field,
			options,
			onclickFun = () => {},
		}: {
			name: string;
			field: string;
			options: Record<string, string>;
			onclickFun?: () => void;
		}) {
			const [value, setValue] = useState(CONFIG[field]);
			return React.createElement(
				"div",
				{ className: "popup-row" },
				React.createElement("label", { className: "col description" }, name),
				React.createElement(
					"div",
					{ className: "col action" },
					React.createElement(
						"select",
						{
							value,
							onChange: (e: any) => {
								setValue(e.target.value);
								CONFIG[field] = e.target.value;
								saveConfig();
								onclickFun();
							},
						},
						Object.keys(options).map((item) =>
							React.createElement(
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
		}

		const settingsDOMContent = React.createElement(
			"div",
			{ className: "shuffle-plus-settings" },
			React.createElement(
				"div",
				{ className: "popup-row" },
				React.createElement("h3", { className: "div-title" }, "Artist Shuffle"),
			),
			React.createElement(
				"div",
				{ className: "popup-row" },
				React.createElement("hr", { className: "divider" }, null),
			),
			React.createElement(dropDownItem, {
				name: "Shuffle mode Artist Page",
				field: "artistMode",
				options: {
					all: "All",
					album: "Albums",
					single: "Singles & EP",
					likedSongArtist: "Artist's Liked Songs",
					topTen: "Top 10 Songs",
				},
			}),
			React.createElement(checkBoxItem, {
				name: "Chosen artist must be included",
				field: "artistNameMust",
			}),
			React.createElement(checkBoxItem, {
				name: "Enable Shuffle+ Queue Tracks button in Playbar",
				field: "enableQueueButton",
				onclickFun: () => renderQueuePlaybarButton(),
			}),
		);

		Spicetify.PopupModal.display({
			title: "Shuffle+",
			content: settingsDOMContent,
			isLarge: true,
		});
	}

	const menuItem = new Spicetify.Menu.Item("Shuffle+", false, settingsPage, "shuffle");
	menuItem.register();

	function shouldAddShufflePlus(uri: string[]) {
		if (uri.length === 1) {
			const uriObj = Spicetify.URI.fromString(uri[0]);
			switch (uriObj.type) {
				case Type.PLAYLIST:
				case Type.PLAYLIST_V2:
				case Type.ALBUM:
				case Type.ARTIST:
				case Type.COLLECTION:
				case Type.FOLDER:
				case Type.SHOW:
					return true;
			}
			return false;
		}
		return true;
	}

	function shouldAddShufflePlusLiked(uri: string[]) {
		const uriObj = Spicetify.URI.fromString(uri[0]);
		if (Spicetify.Platform.History.location.pathname === "/collection/tracks") {
			switch (uriObj.type) {
				case Type.TRACK:
					return true;
			}
		}
		return false;
	}

	function shouldAddShufflePlusLocal(uri: string[]) {
		const uriObj = Spicetify.URI.fromString(uri[0]);
		if (Spicetify.Platform.History.location.pathname === "/collection/local-files") {
			switch (uriObj.type) {
				case Type.TRACK:
				case Type.LOCAL_TRACK:
					return true;
			}
		}
		return false;
	}

	const contextMenuItems = [
		new Spicetify.ContextMenu.Item(
			"Play with Shuffle+",
			async (uri: string[]) => {
				if (uri.length === 1) {
					await fetchAndPlay(uri[0]);
					return;
				}
				await fetchAndPlay(uri);
			},
			shouldAddShufflePlus,
			"shuffle",
		),
		new Spicetify.ContextMenu.Item(
			"Shuffle+ Liked Songs",
			async (uri: string[]) => {
				await fetchAndPlay(uri[0]);
			},
			shouldAddShufflePlusLiked,
			"heart-active",
		),
		new Spicetify.ContextMenu.Item(
			"Shuffle+ Local Files",
			async (uri: string[]) => {
				await fetchAndPlay(uri[0]);
			},
			shouldAddShufflePlusLocal,
			"playlist-folder",
		),
	];
	contextMenuItems.forEach((item) => item.register());

	function renderQueuePlaybarButton() {
		if (!playbarButton) {
			playbarButton = new Spicetify.Playbar.Button(
				"Shuffle+ Queue Tracks",
				"enhance",
				async () => {
					await fetchAndPlay("queue");
				},
				false,
				false,
			);
		}

		if (CONFIG.enableQueueButton) playbarButton.register();
		else playbarButton.deregister();
	}
	renderQueuePlaybarButton();

	async function fetchPlaylistTracks(uri: string) {
		const res = await Spicetify.Platform.PlaylistAPI.getContents(`spotify:playlist:${uri}`, {
			limit: 9999999,
		});
		return res.items.filter((track: any) => track.isPlayable).map((track: any) => track.uri);
	}

	async function fetchFolderTracks(uri: string) {
		const res = await Spicetify.Platform.RootlistAPI.getContents();

		const requestFolder = searchFolder(res.items, uri);
		if (!requestFolder) throw "Cannot find folder";

		const requestPlaylists: string[][] = [];
		async function fetchNested(folder: any) {
			if (!folder.items) return;

			for (const i of folder.items) {
				if (i.type === "playlist") {
					const uriObj = Spicetify.URI.fromString(i.uri) as any;
					const uri = uriObj._base62Id ?? uriObj.id;
					requestPlaylists.push(await fetchPlaylistTracks(uri));
				} else if (i.type === "folder") await fetchNested(i);
			}
		}

		await fetchNested(requestFolder);

		return requestPlaylists.flat();
	}

	async function fetchAlbumTracks(uri: string, includeMetadata = false) {
		const { queryAlbumTracks } = Spicetify.GraphQL.Definitions;
		const { data, errors } = await Spicetify.GraphQL.Request(queryAlbumTracks, {
			uri,
			offset: 0,
			limit: 100,
		});

		if (errors) throw errors[0].message;
		if (data.albumUnion.playability.playable === false) throw "Album is not playable";

		return (data.albumUnion?.tracksV2 ?? data.albumUnion?.tracks ?? []).items
			.filter(({ track }: any) => track.playability.playable)
			.map(({ track }: any) => (includeMetadata ? track : track.uri));
	}

	const artistFetchTypeCount: Record<string, number> = { album: 0, single: 0 };

	async function scanForTracksFromAlbums(res: any[], artistName: string, type: string) {
		const allTracks: string[] = [];

		for (const album of res) {
			let albumRes;

			try {
				albumRes = await fetchAlbumTracks(album.uri, true);
			} catch (error) {
				console.error(album, error);
				continue;
			}

			artistFetchTypeCount[type]++;
			Spicetify.showNotification(`${artistFetchTypeCount[type]} / ${res.length} ${type}s`);

			for (const track of albumRes) {
				if (matchesArtistFilter(track, artistName, CONFIG.artistNameMust)) allTracks.push(track.uri);
			}
		}

		return allTracks;
	}

	async function fetchArtistTracks(uri: string) {
		// Definitions from older Spotify version
		const queryArtistOverview = {
			name: "queryArtistOverview",
			operation: "query",
			sha256Hash: "35648a112beb1794e39ab931365f6ae4a8d45e65396d641eeda94e4003d41497",
			value: null,
		};
		const queryArtistDiscographyAll = {
			name: "queryArtistDiscographyAll",
			operation: "query",
			sha256Hash: "9380995a9d4663cbcb5113fef3c6aabf70ae6d407ba61793fd01e2a1dd6929b0",
			value: null,
		};

		const discography = await Spicetify.GraphQL.Request(queryArtistDiscographyAll, {
			uri,
			offset: 0,
			// Limit 100 since GraphQL has resource limit
			limit: 100,
		});
		if (discography.errors) throw discography.errors[0].message;

		const overview = await Spicetify.GraphQL.Request(queryArtistOverview, {
			uri,
			locale: Spicetify.Locale.getLocale(),
			includePrerelease: false,
		});
		if (overview.errors) throw overview.errors[0].message;

		const artistName = overview.data.artistUnion.profile.name;
		const releases = discography.data.artistUnion.discography.all.items.flatMap(
			({ releases }: any) => releases.items,
		);

		const artistAlbums = releases.filter((album: any) => album.type === "ALBUM");
		const artistSingles = releases.filter((album: any) => album.type === "SINGLE" || album.type === "EP");

		if (artistAlbums.length === 0 && artistSingles.length === 0) throw "Artist has no releases";

		const allArtistAlbumsTracks =
			CONFIG.artistMode !== "single" ? await scanForTracksFromAlbums(artistAlbums, artistName, "album") : [];
		const allArtistSinglesTracks =
			CONFIG.artistMode !== "album" ? await scanForTracksFromAlbums(artistSingles, artistName, "single") : [];

		return allArtistAlbumsTracks.concat(allArtistSinglesTracks);
	}

	async function fetchArtistLikedTracks(uri: string) {
		const artistRes = await Spicetify.CosmosAsync.get(
			`sp://core-collection/unstable/@/list/tracks/artist/${uri}?responseFormat=protobufJson`,
		);

		const allTracks = artistRes.item?.map((artistTrack: any) => {
			if (artistTrack.trackMetadata.playable) return artistTrack.trackMetadata.link;
		});

		return allTracks ?? [];
	}

	async function fetchArtistTopTenTracks(uri: string) {
		const { queryArtistOverview } = Spicetify.GraphQL.Definitions;
		const { data, errors } = await Spicetify.GraphQL.Request(queryArtistOverview, {
			uri,
			locale: Spicetify.Locale.getLocale(),
			includePrerelease: false,
		});
		if (errors) throw errors[0].message;
		return data.artistUnion.discography.topTracks.items.map(({ track }: any) => track.uri);
	}

	async function fetchLikedTracks() {
		const limit = 9999999;
		const res = await Spicetify.Platform.LibraryAPI.getTracks({ limit });

		return res.items.filter((track: any) => track.isPlayable).map((track: any) => track.uri);
	}

	async function fetchLocalTracks() {
		const res = await Spicetify.Platform.LocalFilesAPI.getTracks();

		return res.map((track: any) => track.uri);
	}

	function fetchQueue() {
		const { _queueState } = Spicetify.Platform.PlayerAPI._queue;
		const nextUp = _queueState.nextUp.map((track: any) => track.uri);
		const queued = _queueState.queued.map((track: any) => track.uri);
		const array = [...new Set([...nextUp, ...queued])];
		const current = _queueState.current?.uri;
		if (current) array.push(current);
		return array;
	}

	async function fetchCollection(uriObj: any) {
		const { category, type } = uriObj;
		const { pathname } = Spicetify.Platform.History.location;

		switch (type) {
			case Type.TRACK:
			case Type.LOCAL_TRACK:
				switch (pathname) {
					case "/collection/tracks":
						return await fetchLikedTracks();
					case "/collection/local-files":
						return await fetchLocalTracks();
				}
				break;
			case Type.COLLECTION:
				switch (category) {
					case "tracks":
						return await fetchLikedTracks();
					case "local-files":
						return await fetchLocalTracks();
				}
		}
	}

	async function fetchShows(uri: string) {
		const res = await Spicetify.CosmosAsync.get(`sp://core-show/v1/shows/${uri}?responseFormat=protobufJson`);
		return res.items
			.filter((track: any) => track.episodePlayState.isPlayable)
			.map((track: any) => track.episodeMetadata.link);
	}

	async function Queue(list: string[], context: string | null, type: string | null) {
		const count = list.length;

		// Delimits the end of our list, as Spotify may add new context tracks to the queue
		list.push("spotify:delimiter");

		const { _queue, _client } = Spicetify.Platform.PlayerAPI._queue;
		const { prevTracks, queueRevision } = _queue;

		// Format tracks with default values
		const nextTracks = buildNextTracks(list);

		// Lowest level setQueue method from vendor~xpui.js
		_client.setQueue({
			nextTracks,
			prevTracks,
			queueRevision,
		});

		if (context) {
			const { sessionId } = Spicetify.Platform.PlayerAPI.getState();
			Spicetify.Platform.PlayerAPI.updateContext(sessionId, {
				uri: context,
				url: `context://${context}`,
			});
		}

		Spicetify.Player.next();

		switch (type) {
			case Type.ARTIST:
				if (CONFIG.artistMode === "topTen") {
					Spicetify.showNotification(`Shuffled Top ${count} Songs`);
					break;
				}
				if (CONFIG.artistMode === "likedSongArtist") {
					Spicetify.showNotification(`Shuffled ${count} Liked Songs`);
					break;
				}
				if (CONFIG.artistMode === "single") {
					Spicetify.showNotification(
						`Shuffled ${artistFetchTypeCount.single} Singles, Total of ${count} Songs`,
					);
					break;
				}
				if (CONFIG.artistMode === "album") {
					Spicetify.showNotification(
						`Shuffled ${artistFetchTypeCount.album} Albums, Total of ${count} Songs`,
					);
					break;
				}
				Spicetify.showNotification(
					`Shuffled ${artistFetchTypeCount.album} Albums, ${artistFetchTypeCount.single} Singles, Total of ${count} Songs`,
				);
				break;
			default:
				Spicetify.showNotification(`Shuffled ${count} Songs`);
		}

		artistFetchTypeCount.album = 0;
		artistFetchTypeCount.single = 0;
	}

	async function fetchAndPlay(rawUri: string | string[]) {
		let list: string[] | undefined;
		let context: string | null;
		let type: string | null = null;
		let uri: string;

		try {
			if (rawUri === "queue") {
				list = fetchQueue();
				context = null;
			} else if (typeof rawUri === "object") {
				list = rawUri;
				context = null;
			} else {
				const uriObj = Spicetify.URI.fromString(rawUri) as any;
				type = uriObj.type;
				uri = uriObj._base62Id ?? uriObj.id;

				switch (type) {
					case Type.PLAYLIST:
					case Type.PLAYLIST_V2:
						list = await fetchPlaylistTracks(uri);
						break;
					case Type.ALBUM:
						list = await fetchAlbumTracks(rawUri);
						break;
					case `${Type.ARTIST}`:
						if (CONFIG.artistMode === "likedSongArtist") {
							list = await fetchArtistLikedTracks(uri);
							break;
						}
						if (CONFIG.artistMode === "topTen") {
							list = await fetchArtistTopTenTracks(rawUri);
							break;
						}
						list = await fetchArtistTracks(rawUri);
						break;
					case Type.TRACK:
					case Type.LOCAL_TRACK:
					case Type.COLLECTION:
						list = await fetchCollection(uriObj);
						break;
					case Type.FOLDER:
						list = await fetchFolderTracks(rawUri);
						break;
					case Type.SHOW:
						list = await fetchShows(uri);
						break;
				}

				if (!list?.length) {
					Spicetify.showNotification("Nothing to play", true);
					return;
				}

				context = rawUri;
				if (type === "folder" || type === "collection" || type === "local") {
					context = null;
				}
			}

			await Queue(shuffle(list!), context, type);
		} catch (error) {
			Spicetify.showNotification(String(error), true);
			console.error(error);
		}
	}

	// ----- teardown -----
	ctx.defer(() => {
		menuItem.deregister();
		contextMenuItems.forEach((item) => item.deregister());
		playbarButton?.deregister();
	});
}
