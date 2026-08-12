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

import { client, createRegistrar } from "/modules/stdlib/mod.ts";
import { Button, SettingsRow, SettingsSection, Toggle } from "/modules/stdlib/lib/primitives.tsx";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { collectArtistUris, shouldSkipTrack, targetMatchesCurrent, toggleEntry } from "./logic.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { PlaybarButton } from "/modules/stdlib/src/registers/playbarButton.tsx";

const ICON_PATH =
	'<path d="M5.25 3v-.917C5.25.933 6.183 0 7.333 0h1.334c1.15 0 2.083.933 2.083 2.083V3h4.75v1.5h-.972l-1.257 9.544A2.25 2.25 0 0 1 11.041 16H4.96a2.25 2.25 0 0 1-2.23-1.956L1.472 4.5H.5V3h4.75zm1.5-.917V3h2.5v-.917a.583.583 0 0 0-.583-.583H7.333a.583.583 0 0 0-.583.583zM2.986 4.5l1.23 9.348a.75.75 0 0 0 .744.652h6.08a.75.75 0 0 0 .744-.652L13.015 4.5H2.985z"/>';
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentcolor">${ICON_PATH}</svg>`;

const THROW_TEXT = "Place in Trashbin";
const UNTHROW_TEXT = "Remove from Trashbin";

const initValue = <T,>(item: string, defaultValue: T): T => {
	try {
		const value = JSON.parse(client.storage.get(item));
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
	const { useState } = React;
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
		client.storage.set("TrashSongList", JSON.stringify(trashSongList));
		client.storage.set("TrashArtistList", JSON.stringify(trashArtistList));
	};

	const isTrackUri = (uri: string) => client.uri.fromString(uri).type === client.uri.Type.TRACK;

	const shouldSkipCurrentTrack = (uri: string, type: string): boolean => {
		const curTrack = client.player.data?.item;
		if (!curTrack) return false;
		if (type !== client.uri.Type.TRACK && type !== client.uri.Type.ARTIST) return false;
		return targetMatchesCurrent(uri, type === client.uri.Type.ARTIST, {
			uri: curTrack.uri,
			artistUris: collectArtistUris(curTrack.metadata),
		});
	};

	const watchChange = () => {
		const data = client.player.data;
		if (!data) return;
		refreshButtons();

		if (userHitBack) {
			userHitBack = false;
			return;
		}
		const item = { uri: data.item.uri, artistUris: collectArtistUris(data.item.metadata) };
		if (shouldSkipTrack(item, trashSongList, trashArtistList)) {
			client.player.next();
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
			client.player.addEventListener("songchange", watchChange);
			watchChange();
		} else {
			skipBackBtn?.removeEventListener("click", onSkipBack);
			client.player.removeEventListener("songchange", watchChange);
		}
		refreshButtons();
	};

	const toggleCurrent = () => {
		const uri = client.player.data?.item?.uri;
		if (!uri) return;
		const { next, added } = toggleEntry(trashSongList, uri);
		trashSongList = next;
		if (added) {
			client.player.next();
			client.notify("Song added to trashbin");
		} else {
			client.notify("Song removed from trashbin");
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
			client.player.addEventListener("songchange", on);
			return () => {
				refreshers.delete(force);
				client.player.removeEventListener("songchange", on);
			};
		}, []);
		const item = client.player.data?.item;
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
		const type = client.uri.fromString(uri).type;
		const isTrack = type === client.uri.Type.TRACK;
		const { next, added } = toggleEntry(isTrack ? trashSongList : trashArtistList, uri);
		if (isTrack) trashSongList = next;
		else trashArtistList = next;
		if (added) {
			if (shouldSkipCurrentTrack(uri, type)) client.player.next();
			client.notify(isTrack ? "Song added to trashbin" : "Artist added to trashbin");
		} else {
			client.notify(isTrack ? "Song removed from trashbin" : "Artist removed from trashbin");
		}
		putDataLocal();
		refreshButtons();
	};

	const shouldAddContextMenu = (uris: string[]): boolean => {
		if (uris.length > 1 || !trashbinStatus) return false;
		const type = client.uri.fromString(uris[0]).type;
		if (type === client.uri.Type.TRACK) {
			cntxMenu.name = trashSongList[uris[0]] ? UNTHROW_TEXT : THROW_TEXT;
			return true;
		}
		if (type === client.uri.Type.ARTIST) {
			cntxMenu.name = trashArtistList[uris[0]] ? UNTHROW_TEXT : THROW_TEXT;
			return true;
		}
		return false;
	};

	const cntxMenu = new client.contextMenu.Item(THROW_TEXT, toggleThrow, shouldAddContextMenu, ICON_SVG);
	cntxMenu.register();

	// ----- settings modal (profile menu) -----
	// Settings live on Spotify's settings page rather than in the account
	// dropdown, which is for account actions (see BEST_PRACTICES.md).
	function Settings() {
		const [enabled, setEnabled] = useState(trashbinStatus);
		const [widget, setWidget] = useState(enableWidget);

		return (
			<SettingsSection title="Trashbin">
				<SettingsRow label="Enabled" htmlFor="trashbin-enabled">
					<Toggle
						id="trashbin-enabled"
						value={enabled}
						onChange={(value) => {
							setEnabled(value);
							client.storage.set("trashbin-enabled", String(value));
							refreshEventListeners(value);
						}}
					/>
				</SettingsRow>
				<SettingsRow label="Show the playbar button" htmlFor="trashbin-widget-enabled">
					<Toggle
						id="trashbin-widget-enabled"
						value={widget}
						onChange={(value) => {
							setWidget(value);
							enableWidget = value;
							client.storage.set("TrashbinWidgetIcon", String(value));
							refreshButtons();
						}}
					/>
				</SettingsRow>
				<SettingsRow label="Copy all trashbin items to the clipboard">
					<Button
						variant="secondary"
						onClick={() => {
							client.platform.ClipboardAPI.copy(
								JSON.stringify({ songs: trashSongList, artists: trashArtistList }),
							);
							client.notify("Copied to clipboard");
						}}
					>
						Copy
					</Button>
				</SettingsRow>
				<SettingsRow label="Save the trashbin to a .json file">
					<Button variant="secondary" onClick={() => void exportItems()}>
						Export
					</Button>
				</SettingsRow>
				<SettingsRow label="Overwrite the trashbin from a .json file">
					<Button variant="secondary" onClick={importItems}>
						Import
					</Button>
				</SettingsRow>
				<SettingsRow label="Clear every item from the trashbin (cannot be undone)">
					<Button
						variant="danger"
						onClick={() => {
							trashSongList = {};
							trashArtistList = {};
							putDataLocal();
							refreshButtons();
							client.notify("Trashbin cleared!");
						}}
					>
						Clear
					</Button>
				</SettingsRow>
			</SettingsSection>
		);
	}

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
			client.notify("Backup saved successfully.");
		} catch {
			client.notify("Failed to save. Copy the trashbin contents to clipboard instead.");
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
					client.notify("File Import Successful!");
				} catch (err) {
					client.notify("File Import Failed!", true);
					console.error(err);
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}

	registrar.register("settingsSection", <Settings />);

	// ----- boot -----
	putDataLocal();
	refreshEventListeners(trashbinStatus);

	// ----- teardown -----
	ctx.defer(() => {
		skipBackBtn?.removeEventListener("click", onSkipBack);
		client.player.removeEventListener("songchange", watchChange);
		cntxMenu.deregister();
	});
}
