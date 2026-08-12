/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "WebNowPlaying" extension
 * by khanhas and keifufu (based on WebNowPlaying-Redux). It bridges now-playing
 * metadata and playback controls to a local companion adapter (Rainmeter, OBS,
 * ...) over a WebSocket at ws://localhost:8974, supporting both the Rev1 and the
 * legacy Rainmeter (< 0.5.0) protocols. The companion adapter is a separate app
 * the user installs; with nothing listening on the port the socket simply keeps
 * retrying quietly.
 *
 * The player APIs, LibraryAPI and event model are v2-compatible in v3, so the
 * logic is kept near-verbatim. Three latent bugs from the classic build are
 * fixed because they misbehave badly here rather than being cosmetic:
 *   - retry() used an undeclared `reconnectAttempts` field, so the backoff delay
 *     was NaN and the socket reconnected in a tight loop whenever the companion
 *     was absent (the common case). It now uses the declared `reconnectCount`.
 *   - close() and the SendUpdate helpers referenced `this.ws`/bare `cache`/`ws`
 *     that do not exist; they now use `this._ws` / `self.cache` / `self.send`.
 *   - the 500ms update interval was never cleared on close; it is now.
 * Teardown routes through ctx.defer.
 */

import { client, type ModuleRuntimeContext, type PlayerState } from "/modules/stdlib/mod.ts";

import {
	nextRepeatState,
	parsePositionPercentage,
	ratingShouldToggleHeart,
	timeInSecondsToString,
	togglePlayingState,
} from "./logic.ts";

type Revision = "legacy" | "1" | null;

interface SpicetifyInfo {
	player: string;
	state: string;
	title: string;
	artist: string;
	album: string;
	cover: string;
	duration: string;
	position: string;
	volume: number;
	rating: number;
	repeat: string;
	shuffle: boolean;
	[key: string]: string | number | boolean;
}

// Convert seconds to a time string acceptable to Rainmeter

class WNPReduxWebSocket {
	_ws: WebSocket | null = null;
	cache = new Map<string, unknown>();
	reconnectCount = 0;
	updateInterval: number | null = null;
	communicationRevision: Revision = null;
	connectionTimeout: number | null = null;
	reconnectTimeout: number | null = null;
	isClosed = false;
	onSongChange: (e: { data: PlayerState }) => void;
	onPlayPause: (e: { data: PlayerState }) => void;
	spicetifyInfo: SpicetifyInfo = {
		player: "Spotify Desktop",
		state: "STOPPED",
		title: "",
		artist: "",
		album: "",
		cover: "",
		duration: "0:00",
		// position and volume are fetched in sendUpdate()
		position: "0:00",
		volume: 100,
		rating: 0,
		repeat: "NONE",
		shuffle: false,
	};

	constructor() {
		this.init();

		this.onSongChange = ({ data }) => this.updateSpicetifyInfo(data);
		this.onPlayPause = ({ data }) => this.updateSpicetifyInfo(data);
		client.player.addEventListener("songchange", this.onSongChange as any);
		client.player.addEventListener("onplaypause", this.onPlayPause as any);
	}

	updateSpicetifyInfo(data: PlayerState) {
		if (!data?.item?.metadata) return;
		const meta = data.item.metadata as Record<string, string>;
		this.spicetifyInfo.title = meta.title;
		this.spicetifyInfo.album = meta.album_title;
		this.spicetifyInfo.duration = timeInSecondsToString(Math.round(Number.parseInt(meta.duration) / 1000));
		this.spicetifyInfo.state = !data.isPaused ? "PLAYING" : "PAUSED";
		this.spicetifyInfo.repeat = data.repeat === 2 ? "ONE" : data.repeat === 1 ? "ALL" : "NONE";
		this.spicetifyInfo.shuffle = data.shuffle;
		this.spicetifyInfo.artist = meta.artist_name;
		let artistCount = 1;
		while (meta[`artist_name:${artistCount}`]) {
			this.spicetifyInfo.artist += `, ${meta[`artist_name:${artistCount}`]}`;
			artistCount++;
		}
		if (!this.spicetifyInfo.artist) this.spicetifyInfo.artist = meta.album_title; // Podcast

		client.platform.LibraryAPI.contains(data.item.uri).then(([added]: [boolean]) => {
			this.spicetifyInfo.rating = added ? 5 : 0;
		});

		const cover = meta.image_xlarge_url;
		if (cover?.indexOf("localfile") === -1)
			this.spicetifyInfo.cover = `https://i.scdn.co/image/${cover.substring(cover.lastIndexOf(":") + 1)}`;
		else this.spicetifyInfo.cover = "";
	}

	init() {
		try {
			this._ws = new WebSocket("ws://localhost:8974");
			this._ws.onopen = this.onOpen.bind(this);
			this._ws.onclose = this.onClose.bind(this);
			this._ws.onerror = this.onError.bind(this);
			this._ws.onmessage = this.onMessage.bind(this);
		} catch {
			this.retry();
		}
	}

	close(cleanupOnly = false) {
		if (!cleanupOnly) this.isClosed = true;
		this.cache = new Map();
		this.communicationRevision = null;
		if (this.updateInterval) clearInterval(this.updateInterval);
		if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
		if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
		if (this._ws) {
			this._ws.onclose = null;
			this._ws.close();
		}
	}

	// Clean up old variables and retry connection
	retry() {
		if (this.isClosed) return;
		this.close(true);
		// Reconnects once per second for 30 seconds, then with an exponential
		// backoff of (2^reconnectCount) up to 60 seconds.
		this.reconnectTimeout = window.setTimeout(
			() => {
				this.init();
				this.reconnectCount += 1;
			},
			Math.min(1000 * (this.reconnectCount <= 30 ? 1 : 2 ** (this.reconnectCount - 30)), 60000),
		);
	}

	send(data: string) {
		if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
		this._ws.send(data);
	}

	onOpen() {
		this.reconnectCount = 0;
		this.updateInterval = window.setInterval(this.sendUpdate.bind(this), 500);
		// If no communication revision is received within 1 second, assume it's WNP for Rainmeter < 0.5.0 (legacy)
		this.connectionTimeout = window.setTimeout(() => {
			if (this.communicationRevision === null) this.communicationRevision = "legacy";
		}, 1000);
	}

	onClose() {
		this.retry();
	}

	onError() {
		this.retry();
	}

	onMessage(event: MessageEvent) {
		if (this.communicationRevision) {
			switch (this.communicationRevision) {
				case "legacy":
					OnMessageLegacy(this, event.data);
					break;
				case "1":
					OnMessageRev1(this, event.data);
					break;
			}

			// Sending an update immediately would normally do nothing, as it takes some time for
			// spicetifyInfo to be updated via the Cosmos subscription. However, we try to
			// optimistically update spicetifyInfo after receiving events.
			this.sendUpdate();
		} else {
			if (event.data.startsWith("Version:")) {
				// 'Version:' WNP for Rainmeter 0.5.0 (legacy)
				this.communicationRevision = "legacy";
			} else if (event.data.startsWith("ADAPTER_VERSION ")) {
				// Any WNPRedux adapter will send 'ADAPTER_VERSION <version>;WNPRLIB_REVISION <revision>' after connecting
				this.communicationRevision = event.data.split(";")[1].split(" ")[1];
			} else {
				// The first message wasn't version related, so it's probably WNP for Rainmeter < 0.5.0 (legacy)
				this.communicationRevision = "legacy";
			}
		}
	}

	sendUpdate() {
		if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
		switch (this.communicationRevision) {
			case "legacy":
				SendUpdateLegacy(this);
				break;
			case "1":
				SendUpdateRev1(this);
				break;
		}
	}
}

function OnMessageLegacy(self: WNPReduxWebSocket, message: string) {
	// Quite lengthy functions because we optimistically update spicetifyInfo after receiving events.
	try {
		const [type, data] = message.toUpperCase().split(" ");
		switch (type) {
			case "PLAYPAUSE": {
				client.player.togglePlay();
				self.spicetifyInfo.state = togglePlayingState(self.spicetifyInfo.state);
				break;
			}
			case "NEXT":
				client.player.next();
				break;
			case "PREVIOUS":
				client.player.back();
				break;
			case "SETPOSITION": {
				// Example string: SetPosition 34:SetProgress 0,100890207715134:
				const [, positionPercentage] = message.toUpperCase().split(":")[1].split("SETPROGRESS ");
				client.player.seek(Number.parseFloat(positionPercentage.replace(",", ".")));
				break;
			}
			case "SETVOLUME":
				client.player.setVolume(Number.parseInt(data) / 100);
				break;
			case "REPEAT": {
				client.player.toggleRepeat();
				self.spicetifyInfo.repeat = nextRepeatState(self.spicetifyInfo.repeat);
				break;
			}
			case "SHUFFLE": {
				client.player.toggleShuffle();
				self.spicetifyInfo.shuffle = !self.spicetifyInfo.shuffle;
				break;
			}
			case "TOGGLETHUMBSUP": {
				client.player.toggleHeart();
				self.spicetifyInfo.rating = self.spicetifyInfo.rating === 5 ? 0 : 5;
				break;
			}
			// Spotify doesn't have a negative rating
			// case 'TOGGLETHUMBSDOWN': break
			case "RATING": {
				const rating = Number.parseInt(data);
				const isLiked = self.spicetifyInfo.rating > 3;
				if (rating >= 3 && !isLiked) client.player.toggleHeart();
				else if (rating < 3 && isLiked) client.player.toggleHeart();
				self.spicetifyInfo.rating = rating;
				break;
			}
		}
	} catch (e) {
		self.send(`Error:Error sending event to ${self.spicetifyInfo.player}`);
		self.send(`ErrorD:${e}`);
	}
}

function SendUpdateLegacy(self: WNPReduxWebSocket) {
	if (!client.player.data && self.cache.get("state") !== 0) {
		self.cache.set("state", 0);
		self.send("STATE:0");
		return;
	}

	self.spicetifyInfo.position = timeInSecondsToString(Math.round(client.player.getProgress() / 1000));
	self.spicetifyInfo.volume = Math.round(client.player.getVolume() * 100);

	for (const key of Object.keys(self.spicetifyInfo)) {
		try {
			let value: string | number | boolean = self.spicetifyInfo[key];
			// For numbers, round it to an integer
			if (typeof value === "number") value = Math.round(value);

			// Conversion to legacy values
			if (key === "state") value = value === "PLAYING" ? 1 : value === "PAUSED" ? 2 : 0;
			else if (key === "repeat") value = value === "ALL" ? 2 : value === "ONE" ? 1 : 0;
			else if (key === "shuffle") value = value ? 1 : 0;

			// Check for null, and not just falsy, because 0 and '' are falsy
			if (value !== null && value !== self.cache.get(key)) {
				self.send(`${key.toUpperCase()}:${value}`);
				self.cache.set(key, value);
			}
		} catch (e) {
			self.send(`Error: Error updating ${key} for ${self.spicetifyInfo.player}`);
			self.send(`ErrorD:${e}`);
		}
	}
}

function OnMessageRev1(self: WNPReduxWebSocket, message: string) {
	// Quite lengthy functions because we optimistically update spicetifyInfo after receiving events.
	const [type, data] = message.split(" ");

	try {
		switch (type) {
			case "TOGGLE_PLAYING": {
				client.player.togglePlay();
				self.spicetifyInfo.state = togglePlayingState(self.spicetifyInfo.state);
				break;
			}
			case "NEXT":
				client.player.next();
				break;
			case "PREVIOUS":
				client.player.back();
				break;
			case "SET_POSITION": {
				client.player.seek(parsePositionPercentage(data));
				break;
			}
			case "SET_VOLUME":
				client.player.setVolume(Number.parseInt(data) / 100);
				break;
			case "TOGGLE_REPEAT": {
				client.player.toggleRepeat();
				self.spicetifyInfo.repeat = nextRepeatState(self.spicetifyInfo.repeat);
				break;
			}
			case "TOGGLE_SHUFFLE": {
				client.player.toggleShuffle();
				self.spicetifyInfo.shuffle = !self.spicetifyInfo.shuffle;
				break;
			}
			case "TOGGLE_THUMBS_UP": {
				client.player.toggleHeart();
				self.spicetifyInfo.rating = self.spicetifyInfo.rating === 5 ? 0 : 5;
				break;
			}
			// Spotify doesn't have a negative rating
			// case 'TOGGLE_THUMBS_DOWN': break
			case "SET_RATING": {
				const rating = Number.parseInt(data);
				if (ratingShouldToggleHeart(rating, self.spicetifyInfo.rating)) client.player.toggleHeart();
				self.spicetifyInfo.rating = rating;
				break;
			}
		}
	} catch (e) {
		self.send(`ERROR Error sending event to ${self.spicetifyInfo.player}`);
		self.send(`ERRORDEBUG ${e}`);
	}
}

function SendUpdateRev1(self: WNPReduxWebSocket) {
	if (!client.player.data && self.cache.get("state") !== "STOPPED") {
		self.cache.set("state", "STOPPED");
		self.send("STATE STOPPED");
		return;
	}

	self.spicetifyInfo.position = timeInSecondsToString(Math.round(client.player.getProgress() / 1000));
	self.spicetifyInfo.volume = Math.round(client.player.getVolume() * 100);

	for (const key of Object.keys(self.spicetifyInfo)) {
		try {
			let value: string | number | boolean = self.spicetifyInfo[key];
			// For numbers, round it to an integer
			if (typeof value === "number") value = Math.round(value);
			// Check for null, and not just falsy, because 0 and '' are falsy
			if (value !== null && value !== self.cache.get(key)) {
				self.send(`${key.toUpperCase()} ${value}`);
				self.cache.set(key, value);
			}
		} catch (e) {
			self.send(`ERROR Error updating ${key} for ${self.spicetifyInfo.player}`);
			self.send(`ERRORDEBUG ${e}`);
		}
	}
}

export default function (ctx: ModuleRuntimeContext) {
	if (!client.cosmos || !client.platform?.LibraryAPI) return;

	const socket = new WNPReduxWebSocket();
	const onBeforeUnload = () => socket.close();
	window.addEventListener("beforeunload", onBeforeUnload);

	ctx.defer(() => {
		window.removeEventListener("beforeunload", onBeforeUnload);
		client.player.removeEventListener("songchange", socket.onSongChange as any);
		client.player.removeEventListener("onplaypause", socket.onPlayPause as any);
		socket.close();
	});
}
