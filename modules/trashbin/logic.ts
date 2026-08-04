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

export function toggleEntry(
	list: Record<string, boolean>,
	uri: string,
): { next: Record<string, boolean>; added: boolean } {
	if (!list[uri]) {
		return { next: { ...list, [uri]: true }, added: true };
	}
	const next = { ...list };
	delete next[uri];
	return { next, added: false };
}
