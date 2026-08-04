/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The client-free half of Shuffle+, hoisted verbatim out of the default
// export so it can be imported and tested. mod.tsx injects everything
// client-bound (storage, CosmosAsync, the player queue).

// Fisher-Yates, kept exactly as shipped: it mutates its input and the final
// filter(Boolean) silently drops falsy entries (empty uris, nulls).
export function shuffle(array: string[]) {
	let counter = array.length;
	if (counter <= 1) return array;

	// While there are elements in the array
	while (counter > 0) {
		// Pick a random index
		const index = Math.floor(Math.random() * counter);

		// Decrease counter by 1
		counter--;

		// And swap the last element with it
		const temp = array[counter];
		array[counter] = array[index];
		array[index] = temp;
	}
	return array.filter(Boolean);
}

// Depth-first search for a folder row by uri in the rootlist tree.
export function searchFolder(rows: any[], uri: string): any {
	for (const r of rows) {
		if (r.type !== "folder" || !r.items) continue;

		if (r.uri === uri) return r;

		const found = searchFolder(r.items, uri);
		if (found) return found;
	}
}

// Parses the stored settings blob. Returns the parsed object, or null when
// the blob is absent or malformed (the caller resets storage and applies
// defaults). Kept quirk: a stored "{}" is a valid object and is returned
// as-is, so settings can legitimately be an empty object with every field
// undefined - defaults apply only when parsing fails.
export function parseStoredConfig(raw: string | null): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(raw as string);
		if (parsed && typeof parsed === "object") {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

// The artist-mode track filter: with artistNameMust off every track passes;
// with it on, at least one credited artist must match the artist's name
// exactly.
export function matchesArtistFilter(track: any, artistName: string, artistNameMust: boolean): boolean {
	return !artistNameMust || track.artists.items.some((artist: any) => artist.profile.name === artistName);
}

// Formats uris into the shape PlayerAPI's lowest-level setQueue expects.
export function buildNextTracks(uris: string[]) {
	return uris.map((uri) => ({
		contextTrack: {
			uri,
			uid: "",
			metadata: {
				is_queued: "false",
			},
		},
		removed: [],
		blocked: [],
		provider: "context",
	}));
}
