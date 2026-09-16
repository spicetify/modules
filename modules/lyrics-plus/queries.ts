/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { QueryClient } from "/modules/stdlib/query.ts";
import { CONFIG } from "./config.ts";
import type { ProviderResult, RenderedLyricLine, TrackInfo, TranslationMode } from "./types.ts";

export type CachedLyrics = ProviderResult & Partial<Record<TranslationMode, RenderedLyricLine[] | null>>;

export class LyricsQueries {
	private token = CONFIG.providers.musixmatch.token;
	private credentialRevision = 0;
	readonly client: QueryClient;
	constructor(client: QueryClient) {
		this.client = client;
	}

	key(uri: string, mode: number) {
		if (this.token !== CONFIG.providers.musixmatch.token) {
			this.token = CONFIG.providers.musixmatch.token;
			this.credentialRevision++;
		}
		return [
			"lyrics",
			uri,
			mode,
			{
				providers: CONFIG.providersOrder.filter((id) => CONFIG.providers[id].on),
				translation: CONFIG.visual["musixmatch-translation-language"],
				dualGenius: CONFIG.visual["dual-genius"],
				credentials: this.credentialRevision,
			},
		] as const;
	}

	get(uri: string, mode: number) {
		return this.client.getQueryData<CachedLyrics>(this.key(uri, mode));
	}

	update(uri: string, mode: number, patch: Partial<CachedLyrics>) {
		this.client.setQueryData<CachedLyrics>(this.key(uri, mode), (previous) =>
			previous ? { ...previous, ...patch, uri } : undefined,
		);
	}

	set(mode: number, lyrics: CachedLyrics) {
		this.client.setQueryData(this.key(lyrics.uri, mode), lyrics);
	}

	rememberMode(uri: string, mode: number) {
		this.client.setQueryData(["selected-mode", uri], mode);
	}

	preferredMode(uri: string): number | undefined {
		return this.client.getQueryData<number>(["selected-mode", uri]);
	}

	async fetch(info: TrackInfo, mode: number, load: (signal: AbortSignal) => Promise<ProviderResult>) {
		const queryKey = this.key(info.uri, mode);
		const result = await this.client.fetchQuery<CachedLyrics>({
			queryKey,
			queryFn: ({ signal }) => load(signal),
		});
		// An unavailable provider is recoverable on the next user request.
		if (!result.provider) this.client.removeQueries({ queryKey, exact: true });
		return result;
	}

	async clear() {
		await this.client.cancelQueries();
		this.client.clear();
	}
}
