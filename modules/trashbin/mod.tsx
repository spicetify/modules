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

import { client, createRegistrar, PlaybarButton, React, type ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { Button, SettingsRow, SettingsSection, Toggle } from "/modules/stdlib/lib/primitives.tsx";
import { collectArtistUris, shouldSkipTrack, targetMatchesCurrent, toggleEntry } from "./logic.ts";

const ICON_PATH =
	'<path d="M9.083.583a2.08 2.08 0 0 1 1.474.61 2.08 2.08 0 0 1 .61 1.473v.583h2.583a.75.75 0 0 1 0 1.5h-.583v8.582a2.09 2.09 0 0 1-1.286 1.927 2.1 2.1 0 0 1-.798.158H4.417v-.001a2.1 2.1 0 0 1-1.474-.61 2.08 2.08 0 0 1-.61-1.474V4.75H1.75a.75.75 0 1 1 0-1.5h2.583v-.583A2.085 2.085 0 0 1 5.619.741c.253-.104.524-.157.798-.157V.583zm-5.25 12.751a.583.583 0 0 0 .583.583h6.668a.58.58 0 0 0 .583-.583V4.75H3.833zm1.834-2.001v-4a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0m2.666 0v-4a.75.75 0 1 1 1.5 0v4a.75.75 0 0 1-1.5 0m-1.917-9.25a.583.583 0 0 0-.583.583v.584h3.834v-.584a.583.583 0 0 0-.583-.583z"/>';
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">${ICON_PATH}</svg>`;

const THROW_TEXT = "Place in Trashbin";
const UNTHROW_TEXT = "Remove from Trashbin";

const initValue = <T,>(item: string, defaultValue: T): T => {
	try {
		const stored = client.storage.get(item);
		if (stored === null) return defaultValue;
		const value = JSON.parse(stored);
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
	const { useState, useEffect } = React;
	const registrar = createRegistrar(ctx);

	let trashSongList: Record<string, any> = initValue("TrashSongList", {});
	let trashArtistList: Record<string, any> = initValue("TrashArtistList", {});
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
		const item = client.player.data?.item;
		if (!item?.uri) return;

		const trackName = item.name || item.metadata?.title || "Unknown Track";
		const artistName = item.metadata?.artist_name || "";
		const displayName = artistName ? `${trackName} - ${artistName}` : trackName;

		const { next, added } = toggleEntry(trashSongList, item.uri, displayName);
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
		useEffect(() => {
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
		const [songs, setSongs] = useState(trashSongList);
		const [searchQuery, setSearchQuery] = useState("");

		useEffect(() => {
			const sync = () => setSongs(trashSongList);
			refreshers.add(sync);
			return () => {
				refreshers.delete(sync);
			};
		}, []);

		const filteredSongs = Object.entries(songs).filter(([uri, name]) => {
			const displayName = typeof name === "string" ? name : uri;
			return displayName.toLowerCase().includes(searchQuery.toLowerCase());
		});

		const removeSong = (uri: string) => {
			const next = { ...trashSongList };
			delete next[uri];
			trashSongList = next;
			setSongs(next);
			putDataLocal();
			refreshButtons();
			client.notify("Song removed from trashbin");
		};

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
							setSongs({});
							putDataLocal();
							refreshButtons();
							client.notify("Trashbin cleared!");
						}}
					>
						Clear
					</Button>
				</SettingsRow>

				<div style={{ marginTop: "20px", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "15px" }}>
					<input
						type="text"
						placeholder="Search trashed songs..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						style={{
							width: "100%",
							padding: "8px 12px",
							marginBottom: "10px",
							borderRadius: "4px",
							border: "1px solid rgba(255,255,255,0.2)",
							background: "rgba(255,255,255,0.05)",
							color: "var(--spice-text, #fff)",
							boxSizing: "border-box",
							outline: "none",
						}}
					/>

					<div style={{ maxHeight: "220px", overflowY: "auto" }}>
						{filteredSongs.length === 0 ? (
							<div style={{ padding: "10px", color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
								{searchQuery ? "No matching songs found" : "Trashbin is empty"}
							</div>
						) : (
							filteredSongs.map(([uri, name]) => (
								<SettingsRow key={uri} label={typeof name === "string" ? name : uri}>
									<Button variant="secondary" onClick={() => removeSong(uri)}>
										Remove
									</Button>
								</SettingsRow>
							))
						)}
					</div>
				</div>
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
