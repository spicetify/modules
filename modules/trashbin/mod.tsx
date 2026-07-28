/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "Trashbin" extension by
 * khanhas and OhItsTom. The client's v2-compatible Menu, ContextMenu, URI and
 * LocalStorage helpers still work in v3, so they are kept; only the playbar
 * widget is re-expressed through the v3 playbarButton register (the classic
 * Playbar.Widget no longer mounts in the restructured playbar).
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { PlaybarButton } from "/modules/stdlib/src/registers/playbarButton.tsx";

const ICON_PATH =
	'<path d="M5.25 3v-.917C5.25.933 6.183 0 7.333 0h1.334c1.15 0 2.083.933 2.083 2.083V3h4.75v1.5h-.972l-1.257 9.544A2.25 2.25 0 0 1 11.041 16H4.96a2.25 2.25 0 0 1-2.23-1.956L1.472 4.5H.5V3h4.75zm1.5-.917V3h2.5v-.917a.583.583 0 0 0-.583-.583H7.333a.583.583 0 0 0-.583.583zM2.986 4.5l1.23 9.348a.75.75 0 0 0 .744.652h6.08a.75.75 0 0 0 .744-.652L13.015 4.5H2.985z"/>';
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentcolor">${ICON_PATH}</svg>`;

const THROW_TEXT = "Place in Trashbin";
const UNTHROW_TEXT = "Remove from Trashbin";

const initValue = <T,>(item: string, defaultValue: T): T => {
	try {
		const value = JSON.parse(Spicetify.LocalStorage.get(item));
		return value ?? defaultValue;
	} catch {
		return defaultValue;
	}
};

const findSkipBackButton = (): HTMLElement | null =>
	document.querySelector('[data-testid="control-button-skip-back"]') ??
	document.querySelector(".main-skipBackButton-button") ??
	document.querySelector(".player-controls__left > button[data-encore-id='buttonTertiary']");

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);

	let trashSongList: Record<string, boolean> = initValue("TrashSongList", {});
	let trashArtistList: Record<string, boolean> = initValue("TrashArtistList", {});
	let trashbinStatus: boolean = initValue("trashbin-enabled", true);
	let enableWidget: boolean = initValue("TrashbinWidgetIcon", true);
	let userHitBack = false;

	// Playbar buttons are React; a shared refresher set re-renders them whenever
	// the lists or settings change from outside React (context menu, settings).
	const refreshers = new Set<() => void>();
	const refreshButtons = () => refreshers.forEach((f) => f());

	const putDataLocal = () => {
		Spicetify.LocalStorage.set("TrashSongList", JSON.stringify(trashSongList));
		Spicetify.LocalStorage.set("TrashArtistList", JSON.stringify(trashArtistList));
	};

	const isTrackUri = (uri: string) => Spicetify.URI.fromString(uri).type === Spicetify.URI.Type.TRACK;

	const shouldSkipCurrentTrack = (uri: string, type: string): boolean => {
		const curTrack = Spicetify.Player.data?.item;
		if (!curTrack) return false;
		if (type === Spicetify.URI.Type.TRACK) return uri === curTrack.uri;
		if (type === Spicetify.URI.Type.ARTIST) {
			let count = 1;
			let artUri = curTrack.metadata.artist_uri;
			while (artUri) {
				if (uri === artUri) return true;
				artUri = curTrack.metadata[`artist_uri:${count}`];
				count++;
			}
		}
		return false;
	};

	const watchChange = () => {
		const data = Spicetify.Player.data;
		if (!data) return;
		refreshButtons();

		if (userHitBack) {
			userHitBack = false;
			return;
		}
		if (trashSongList[data.item.uri]) {
			Spicetify.Player.next();
			return;
		}
		let uriIndex = 0;
		let artistUri = data.item.metadata.artist_uri;
		while (artistUri) {
			if (trashArtistList[artistUri]) {
				Spicetify.Player.next();
				return;
			}
			uriIndex++;
			artistUri = data.item.metadata[`artist_uri:${uriIndex}`];
		}
	};

	const onSkipBack = () => {
		userHitBack = true;
	};

	let skipBackBtn = findSkipBackButton();
	const refreshEventListeners = (state: boolean) => {
		trashbinStatus = state;
		if (state) {
			skipBackBtn?.addEventListener("click", onSkipBack);
			Spicetify.Player.addEventListener("songchange", watchChange);
			watchChange();
		} else {
			skipBackBtn?.removeEventListener("click", onSkipBack);
			Spicetify.Player.removeEventListener("songchange", watchChange);
		}
		refreshButtons();
	};

	const toggleCurrent = () => {
		const uri = Spicetify.Player.data?.item?.uri;
		if (!uri) return;
		if (!trashSongList[uri]) {
			trashSongList[uri] = true;
			Spicetify.Player.next();
			Spicetify.showNotification("Song added to trashbin");
		} else {
			delete trashSongList[uri];
			Spicetify.showNotification("Song removed from trashbin");
		}
		putDataLocal();
		refreshButtons();
	};

	// ----- playbar button (v3 register) -----
	const TrashButton = () => {
		const [, force] = React.useReducer((n: number) => n + 1, 0);
		React.useEffect(() => {
			const on = () => force();
			refreshers.add(force);
			Spicetify.Player.addEventListener("songchange", on);
			return () => {
				refreshers.delete(force);
				Spicetify.Player.removeEventListener("songchange", on);
			};
		}, []);
		const item = Spicetify.Player.data?.item;
		if (!enableWidget || !trashbinStatus || !item || !isTrackUri(item.uri)) return null;
		const active = !!trashSongList[item.uri];
		return (
			<PlaybarButton
				label={active ? UNTHROW_TEXT : THROW_TEXT}
				icon={ICON_PATH}
				isActive={active}
				onClick={toggleCurrent}
			/>
		);
	};
	registrar.register("playbarButton", <TrashButton />);

	// ----- context menu: toggle a track or artist -----
	const toggleThrow = (uris: string[]) => {
		const uri = uris[0];
		const type = Spicetify.URI.fromString(uri).type;
		const isTrack = type === Spicetify.URI.Type.TRACK;
		const list = isTrack ? trashSongList : trashArtistList;
		if (!list[uri]) {
			list[uri] = true;
			if (shouldSkipCurrentTrack(uri, type)) Spicetify.Player.next();
			Spicetify.showNotification(isTrack ? "Song added to trashbin" : "Artist added to trashbin");
		} else {
			delete list[uri];
			Spicetify.showNotification(isTrack ? "Song removed from trashbin" : "Artist removed from trashbin");
		}
		putDataLocal();
		refreshButtons();
	};

	const shouldAddContextMenu = (uris: string[]): boolean => {
		if (uris.length > 1 || !trashbinStatus) return false;
		const type = Spicetify.URI.fromString(uris[0]).type;
		if (type === Spicetify.URI.Type.TRACK) {
			cntxMenu.name = trashSongList[uris[0]] ? UNTHROW_TEXT : THROW_TEXT;
			return true;
		}
		if (type === Spicetify.URI.Type.ARTIST) {
			cntxMenu.name = trashArtistList[uris[0]] ? UNTHROW_TEXT : THROW_TEXT;
			return true;
		}
		return false;
	};

	const cntxMenu = new Spicetify.ContextMenu.Item(THROW_TEXT, toggleThrow, shouldAddContextMenu, ICON_SVG);
	cntxMenu.register();

	// ----- settings modal (profile menu) -----
	const buildSettings = (): HTMLElement => {
		const content = document.createElement("div");
		content.className = "trashbin-settings";

		const sectionTitle = (text: string) => {
			const h = document.createElement("h2");
			h.textContent = text;
			content.appendChild(h);
		};
		const addSlider = (name: string, desc: string, value: boolean, cb: (state: boolean) => void) => {
			const row = document.createElement("div");
			row.className = "setting-row";
			const label = document.createElement("label");
			label.className = "col description";
			label.textContent = desc;
			const action = document.createElement("div");
			action.className = "col action";
			const btn = document.createElement("button");
			btn.className = "switch";
			btn.innerHTML = `<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons.check}</svg>`;
			btn.classList.toggle("disabled", !value);
			btn.onclick = () => {
				const state = btn.classList.contains("disabled");
				btn.classList.toggle("disabled");
				Spicetify.LocalStorage.set(name, String(state));
				cb(state);
			};
			action.appendChild(btn);
			row.append(label, action);
			content.appendChild(row);
		};
		const addButton = (text: string, desc: string, cb: () => void) => {
			const row = document.createElement("div");
			row.className = "setting-row";
			const label = document.createElement("label");
			label.className = "col description";
			label.textContent = desc;
			const action = document.createElement("div");
			action.className = "col action";
			const btn = document.createElement("button");
			btn.className = "reset";
			btn.textContent = text;
			btn.onclick = cb;
			action.appendChild(btn);
			row.append(label, action);
			content.appendChild(row);
		};

		sectionTitle("Options");
		addSlider("trashbin-enabled", "Enabled", trashbinStatus, refreshEventListeners);
		addSlider("TrashbinWidgetIcon", "Show Widget Icon", enableWidget, (state) => {
			enableWidget = state;
			refreshButtons();
		});

		sectionTitle("Local Storage");
		addButton("Copy", "Copy all items in trashbin to clipboard.", () => {
			Spicetify.Platform.ClipboardAPI.copy(JSON.stringify({ songs: trashSongList, artists: trashArtistList }));
			Spicetify.showNotification("Copied to clipboard");
		});
		addButton("Export", "Save all items in trashbin to a .json file.", () => void exportItems());
		addButton("Import", "Overwrite all items in trashbin via .json file.", importItems);
		addButton("Clear", "Clear all items from trashbin (cannot be reverted).", () => {
			trashSongList = {};
			trashArtistList = {};
			putDataLocal();
			refreshButtons();
			Spicetify.showNotification("Trashbin cleared!");
		});
		return content;
	};

	async function exportItems() {
		const data = { songs: trashSongList, artists: trashArtistList };
		try {
			const handle = await (window as any).showSaveFilePicker({
				suggestedName: "spicetify-trashbin.json",
				types: [{ description: "Spicetify trashbin backup", accept: { "application/json": [".json"] } }],
			});
			const writable = await handle.createWritable();
			await writable.write(JSON.stringify(data));
			await writable.close();
			Spicetify.showNotification("Backup saved successfully.");
		} catch {
			Spicetify.showNotification("Failed to save. Copy the trashbin contents to clipboard instead.");
		}
	}

	function importItems() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.onchange = (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (ev) => {
				try {
					const data = JSON.parse(ev.target?.result as string);
					trashSongList = data.songs;
					trashArtistList = data.artists;
					putDataLocal();
					refreshButtons();
					Spicetify.showNotification("File Import Successful!");
				} catch (err) {
					Spicetify.showNotification("File Import Failed!", true);
					console.error(err);
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}

	const menuItem = new Spicetify.Menu.Item(
		"Trashbin",
		false,
		() => Spicetify.PopupModal.display({ title: "Trashbin Settings", content: buildSettings() }),
		ICON_SVG,
	);
	menuItem.register();

	// ----- boot -----
	putDataLocal();
	refreshEventListeners(trashbinStatus);

	// ----- teardown -----
	ctx.defer(() => {
		skipBackBtn?.removeEventListener("click", onSkipBack);
		Spicetify.Player.removeEventListener("songchange", watchChange);
		cntxMenu.deregister();
		menuItem.deregister();
	});
}
