/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Module } from "/hooks/index.ts";

import { Platform } from "./src/expose/Platform.ts";
import { Registrar } from "./src/registers/index.ts";
import { fromString } from "./src/webpack/URI.ts";

import { BehaviorSubject, Subscription } from "https://esm.sh/rxjs";

export const createRegistrar = (mod: Module) => {
	const registrar = new Registrar(mod.getModuleIdentifier());
	const unloadJs = mod._unloadJs!;
	mod._unloadJs = () => {
		registrar!.dispose();
		return unloadJs();
	};
	return registrar;
};

export const createStorage = (mod: Module) => {
	const hookedNativeStorageMethods = new Set(["getItem", "setItem", "removeItem"]);

	return new Proxy(globalThis.localStorage, {
		get(target, p, receiver) {
			if (typeof p === "string" && hookedNativeStorageMethods.has(p)) {
				return (key: string, ...data: any[]) =>
					target[p](`module:${mod.getModuleIdentifier()}:${key}`, ...data);
			}

			return target[p as keyof typeof target];
		},
	});
};

export const createLogger = (mod: Module) => {
	const hookedMethods = new Set(["debug", "error", "info", "log", "warn"]);

	return new Proxy(globalThis.console, {
		get(target, p, receiver) {
			if (typeof p === "string" && hookedMethods.has(p)) {
				// @ts-ignore
				return (...data: any[]) => target[p](`[${mod.getModuleIdentifier()}]:`, ...data);
			}

			return target[p as keyof typeof target];
		},
	});
};

const PlayerAPI = Platform.getPlayerAPI();
const History = Platform.getHistory();

const newEventBus = () => {
	const playerState = PlayerAPI.getState();
	return {
		Player: {
			state_updated: new BehaviorSubject(playerState),
			status_changed: new BehaviorSubject(playerState),
			song_changed: new BehaviorSubject(playerState),
		},
		History: {
			updated: new BehaviorSubject(History.location),
		},
	};
};

const EventBus = newEventBus();
export type EventBus = typeof EventBus;

export const createEventBus = (mod: Module) => {
	const eventBus = newEventBus();
	// TODO: come up with a nicer solution
	const s = new Subscription();
	s.add(EventBus.Player.song_changed.subscribe(eventBus.Player.song_changed));
	s.add(EventBus.Player.state_updated.subscribe(eventBus.Player.state_updated));
	s.add(EventBus.Player.status_changed.subscribe(eventBus.Player.status_changed));
	s.add(EventBus.History.updated.subscribe(eventBus.History.updated));
	const unloadJs = mod._unloadJs!;
	mod._unloadJs = () => {
		s.unsubscribe();
		return unloadJs();
	};

	return eventBus;
};

let cachedState = {};
export const listener = ({ data: state }) => {
	EventBus.Player.state_updated.next(state);
	if (state?.item?.uri !== cachedState?.item?.uri) EventBus.Player.song_changed.next(state);
	if (state?.isPaused !== cachedState?.isPaused || state?.isBuffering !== cachedState?.isBuffering) {
		EventBus.Player.status_changed.next(state);
	}
	cachedState = state;
};
PlayerAPI.getEvents().addListener("update", listener);

export const cancel = History.listen((location) => EventBus.History.updated.next(location));

const PlaylistAPI = Platform.getPlaylistAPI();

export function createSyncedStorage(playlistUri: string) {
	function encodeKey(key: string) {
		return `\x02${key}\x03`;
	}

	async function getUris(key: string) {
		const { items } = await PlaylistAPI.getContents(playlistUri, {
			filter: key,
			limit: 1e9,
		});
		const encodedKey = encodeKey(key);
		return items
			.map((item) => fromString(item.uri))
			.filter((uri) => uri.type === "local")
			.filter((uri) => uri.track === encodedKey);
	}

	async function addKey(encodedKey: string, encodedData: string) {
		const uris = Array
			.from(collectTuples(generateStringChunks(encodedData, 200), 2, ""))
			.map(([a, b], i) => `spotify:local:${a}:${b}:${encodedKey}:${i + 1}`);

		await PlaylistAPI.add(playlistUri, uris, { after: "end" });
	}

	async function removeKey(key: string) {
		const uris = await getUris(key);
		if (uris.length > 0) {
			await PlaylistAPI.remove(playlistUri, uris.map((u) => ({ uri: u.toURI(), uid: "" })));
		}
	}

	function* generateStringChunks(string: string, chunk_size: number) {
		for (let s = "", n = 0, o = 0, l = 0;; l++) {
			if (chunk_size * n + l + o >= string.length) {
				if (l > 0) {
					yield s;
				}
				break;
			}
			s += string[chunk_size * n + l + o];
			if (string[chunk_size * n + l + o] === "%") {
				s += string[chunk_size * n + l + ++o] + string[chunk_size * n + l + ++o];
			}
			if (l === chunk_size - 1) {
				l = -1;
				n++;
				yield s;
				s = "";
			}
		}
	}

	function* collectTuples<T>(gen: Generator<T, void, unknown>, l: number, unit: T) {
		let result: IteratorResult<T, void>;
		let done: boolean | undefined;

		function next() {
			if (done) return unit;
			result = gen.next();
			done = result.done;
			if (done) return unit;
			return result.value;
		}

		while (!done) {
			yield Array.from({ length: l }, next);
		}
	}

	return {
		async getItem(key: string) {
			const uris = await getUris(key);
			if (uris.length === 0) return null;
			const encodedData = uris
				.sort((a, b) => a.duration - b.duration)
				.map((uri) => uri.artist + uri.album)
				.join("");
			return decodeURIComponent(encodedData);
		},
		async setItem(key: string, data: string) {
			const encodedKey = encodeURIComponent(encodeKey(key));
			const encodedData = encodeURIComponent(data);
			await removeKey(key);
			await addKey(encodedKey, encodedData);
			return data;
		},
		async removeItem(key: string) {
			try {
				await removeKey(key);
			} catch (_) {
				return false;
			}
			return true;
		},
	};
}
