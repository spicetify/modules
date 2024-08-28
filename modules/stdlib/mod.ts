/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleInstance } from "/hooks/index.ts";

import { Platform } from "./src/expose/Platform.ts";
import { Registrar } from "./src/registers/index.ts";
import { fromString } from "./src/webpack/URI.ts";

import { BehaviorSubject, Subscription } from "https://esm.sh/rxjs";

export const createRegistrar = (mod: ModuleInstance) => {
	const registrar = new Registrar(mod.getModuleIdentifier());
	const unloadJs = mod._unloadJs!;
	mod._unloadJs = () => {
		registrar!.dispose();
		return unloadJs();
	};
	return registrar;
};

export const createStorage = (mod: ModuleInstance) => {
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

export const createLogger = (mod: ModuleInstance) => {
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

const newEventBus = () => {
	const PlayerAPI = Platform.getPlayerAPI();
	const History = Platform.getHistory();

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

export const createEventBus = (mod: ModuleInstance) => {
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
export const playerListener = ({ data: state }) => {
	EventBus.Player.state_updated.next(state);
	if (state?.item?.uri !== cachedState?.item?.uri) EventBus.Player.song_changed.next(state);
	if (state?.isPaused !== cachedState?.isPaused || state?.isBuffering !== cachedState?.isBuffering) {
		EventBus.Player.status_changed.next(state);
	}
	cachedState = state;
};

export const historyListener = (location) => EventBus.History.updated.next(location);

export function createSyncedStorage(playlistUri: string) {
	const CHUNK_SIZE = 200;
	const MAX_DOUBLE_CHUNKS = 1000;

	const PlaylistAPI = Platform.getPlaylistAPI();

	function markKey(key: string) {
		return `\x02${key}\x03`;
	}

	function assertSmallerSize(encodedKey: string, chunk_size: number, chunk_count: number, message: string) {
		for (let n = 0, o = 0, l = 0;; l++) {
			if (chunk_size * n + l + o >= encodedKey.length) {
				return encodedKey;
			}
			if (n >= chunk_count) {
				throw new Error(message);
			}
			if (encodedKey[chunk_size * n + l + o] === "%") {
				o += 2;
			}
			if (l === chunk_size - 1) {
				l = -1;
				n++;
			}
		}
	}

	async function getUris(key: string) {
		assertSmallerSize(encodeURIComponent(key), CHUNK_SIZE, 1, "Can't fit key in a single chunk");

		const { items } = await PlaylistAPI.getContents(playlistUri, {
			filter: key,
			limit: 1e9,
		});

		return items
			.map((item) => fromString(item.uri))
			.filter((uri) => uri.type === "local")
			.filter((uri) => uri.track === key);
	}

	async function getKey(key: string) {
		const uris = await getUris(key);
		if (uris.length === 0) return null;
		return uris
			.sort((a, b) => a.duration - b.duration)
			.map((uri) => uri.artist + uri.album)
			.join("");
	}

	async function removeKey(key: string) {
		const uris = await getUris(key);
		if (uris.length > 0) {
			await PlaylistAPI.remove(playlistUri, uris.map((u) => ({ uri: u.toURI(), uid: "" })));
		}
	}
	async function addKey(key: string, encodedValue: string) {
		assertSmallerSize(
			encodeURIComponent(key),
			CHUNK_SIZE,
			1,
			"Can't fit key in a single chunk",
		);
		assertSmallerSize(
			encodedValue,
			CHUNK_SIZE,
			MAX_DOUBLE_CHUNKS,
			`Can't fit value in ${MAX_DOUBLE_CHUNKS} double chunks`,
		);

		const uris = Array
			.from(collectTuples(generateStringChunks(encodedValue, CHUNK_SIZE), 2, ""))
			.map(([a, b], i) => `spotify:local:${a}:${b}:${key}:${i + 1}`);

		await PlaylistAPI.add(playlistUri, uris, { after: "end" });
	}

	return {
		async getItem(key: string) {
			const encodedData = await getKey(markKey(key));
			return decodeURIComponent(encodedData);
		},
		async removeItem(key: string) {
			try {
				await removeKey(markKey(key));
			} catch (_) {
				return false;
			}
			return true;
		},
		async setItem(key: string, value: string) {
			const encodedValue = encodeURIComponent(value);
			await removeKey(markKey(key));
			await addKey(markKey(key), encodedValue);
			return value;
		},
	};
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
