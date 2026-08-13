/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface LyricsHistory {
	location: { pathname: string };
	listen(listener: (location: { pathname: string }) => void): void | (() => void);
	push(path: string): void;
	goBack(): void;
}

export function lyricsReplacementReady(visible: boolean, history: LyricsHistory | null): history is LyricsHistory {
	return visible && history !== null;
}

type Timer = ReturnType<typeof setTimeout>;

/** Wait for the wrapper's late History surface and own its listener cleanup. */
export function watchLyricsHistory(
	getHistory: () => LyricsHistory | undefined,
	onReady: (history: LyricsHistory) => void,
	onLocation: (pathname: string) => void,
	schedule: (callback: () => void, delay: number) => Timer = setTimeout,
	cancel: (timer: Timer) => void = clearTimeout,
	maxAttempts = 20,
): () => void {
	let disposed = false;
	let attempts = 0;
	let timer: Timer | undefined;
	let unlisten: (() => void) | undefined;

	const connect = () => {
		if (disposed) return;
		const history = getHistory();
		if (!history) {
			attempts += 1;
			if (attempts >= maxAttempts) return;
			timer = schedule(connect, 300);
			return;
		}
		onReady(history);
		onLocation(history.location.pathname);
		const cleanup = history.listen((location) => onLocation(location.pathname));
		if (typeof cleanup === "function") unlisten = cleanup;
	};
	connect();

	return () => {
		disposed = true;
		if (timer !== undefined) cancel(timer);
		unlisten?.();
	};
}

/** Adopt the CSS that replaces Spotify's native lyrics entry while ours is visible. */
export function mountLyricsPlaybarStyle(document: Document, route: string): () => void {
	const style = document.createElement("style");
	style.textContent = `
		.main-nowPlayingBar-lyricsButton[data-testid="lyrics-button"],
		li[data-id="${route}"] {
			display: none !important;
		}
	`;
	style.classList.add("lyrics-plus:visual:playbar-button");
	document.head.appendChild(style);
	return () => style.remove();
}

export function mountLyricsPlaybarStyleWhenReady(
	document: Document,
	route: string,
	visible: boolean,
	history: LyricsHistory | null,
): void | (() => void) {
	if (!lyricsReplacementReady(visible, history)) return;
	return mountLyricsPlaybarStyle(document, route);
}
