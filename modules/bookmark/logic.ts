/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The pure core of bookmark: naming, filtering and storage-list transforms,
// hoisted from the module closure so they run under node --test. mod.tsx owns
// the DOM, Player/URI access and localStorage I/O.

export interface BookmarkEntry {
	id?: string;
	uri: string;
	[key: string]: unknown;
}

export function idToProperName(id: string): string {
	return id.replace(/-/g, " ").replace(/^.|\s./g, (char) => char.toUpperCase());
}

export function isTrackUri(uri: string): boolean {
	return uri.startsWith("spotify:track:") || uri.startsWith("spotify:episode:");
}

// filter: 0 = all, 1 = pages only, 2 = tracks/episodes only.
export function filterBookmarks<T extends BookmarkEntry>(items: T[], filter: number): T[] {
	if (filter === 0) return items;
	return items.filter((item) => (filter === 1 ? !isTrackUri(item.uri) : isTrackUri(item.uri)));
}

export function withNewEntry<T extends BookmarkEntry>(list: T[], data: T, now: number): T[] {
	return [{ ...data, id: `${data.uri}-${now}` }, ...list];
}

export function withoutEntry<T extends BookmarkEntry>(list: T[], id: string): T[] {
	return list.filter((item) => item.id !== id);
}

export function largestImage<T extends { width: number; url: string }>(sources: T[]): T {
	return sources.reduce((prev, curr) => (prev.width > curr.width ? prev : curr));
}
