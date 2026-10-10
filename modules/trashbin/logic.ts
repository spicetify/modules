/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The pure core of trashbin: the artist-uri chain walk, the skip decision and
// the list toggle, hoisted from the module closure so they run under
// node --test. mod.tsx owns Player events, storage I/O and the React button.

// Player metadata carries artists as artist_uri, artist_uri:1, artist_uri:2...
export function collectArtistUris(metadata: Record<string, string | undefined>): string[] {
	const uris: string[] = [];
	let count = 1;
	let artUri = metadata.artist_uri;
	while (artUri) {
		uris.push(artUri);
		artUri = metadata[`artist_uri:${count}`];
		count++;
	}
	return uris;
}

export function shouldSkipTrack(
	item: { uri: string; artistUris: string[] },
	songList: Record<string, boolean>,
	artistList: Record<string, boolean>,
): boolean {
	if (songList[item.uri]) return true;
	return item.artistUris.some((uri) => artistList[uri]);
}

export function targetMatchesCurrent(
	targetUri: string,
	targetIsArtist: boolean,
	current: { uri: string; artistUris: string[] },
): boolean {
	if (!targetIsArtist) return targetUri === current.uri;
	return current.artistUris.includes(targetUri);
}

export type TrashList = Record<string, boolean>;
export type TrashedEntry = { uri: string; kind: "song" | "artist" };

// A stored list is uri -> true. Anything else truthy (an older build stored
// display names here) still means trashed; malformed storage means empty.
export function normalizeList(value: unknown): TrashList {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, trashed]) => !!trashed)
			.map(([uri]) => [uri, true]),
	);
}

export function trackLabel(title: string, artists: string[]): string {
	return artists.length ? `${artists.join(", ")} - ${title}` : title;
}

// Insertion order is trash order, so reversing a list puts the newest first.
export function trashedEntries(songs: TrashList, artists: TrashList): TrashedEntry[] {
	return [
		...Object.keys(songs)
			.reverse()
			.map((uri) => ({ uri, kind: "song" as const })),
		...Object.keys(artists)
			.reverse()
			.map((uri) => ({ uri, kind: "artist" as const })),
	];
}

export function matchingEntries(
	entries: TrashedEntry[],
	labelOf: (uri: string) => string | undefined,
	query: string,
): TrashedEntry[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return entries;
	return entries.filter(({ uri }) => (labelOf(uri) ?? uri).toLowerCase().includes(needle));
}

export function toggleEntry(list: TrashList, uri: string): { next: TrashList; added: boolean } {
	if (!list[uri]) {
		return { next: { ...list, [uri]: true }, added: true };
	}
	const next = { ...list };
	delete next[uri];
	return { next, added: false };
}
