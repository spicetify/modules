/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Genius: unsynced lyrics with artist annotations. Note the surface differs
// from the other providers by design: { fetchLyrics, getNote,
// fetchLyricsVersion } — there is no getSynced/getUnsynced here.

import { responseRecord as record } from "../cosmos-responses.ts";
import { removeExtraInfo, removeSongFeat } from "../utils.ts";
import { getLyricsResponse, requestLyrics } from "../runtime-client.ts";

import type { GeniusVersion, TrackInfo } from "../types.ts";

export const ProviderGenius = (() => {
	function getChildDeep(value: unknown, isDeep = false): string {
		let acc = "";
		const parent = record(value);

		if (!Array.isArray(parent.children)) {
			return acc;
		}

		for (const child of parent.children) {
			if (typeof child === "string") {
				acc += child;
			} else if (record(child).children) {
				acc += getChildDeep(child, true);
			}
			if (!isDeep) {
				acc += "\n";
			}
		}
		return acc.trim();
	}

	async function getNote(id: string | number, signal?: AbortSignal): Promise<string> {
		const body = record(await getLyricsResponse(`https://genius.com/api/annotations/${id}`, signal));
		const response = record(body.response);
		const annotation = record(response.annotation);
		let note = "";

		// Authors annotations
		if (record(response.referent).classification === "verified") {
			const referentsBody = record(await getLyricsResponse(`https://genius.com/api/referents/${id}`, signal));
			const annotations = record(record(referentsBody.response).referent).annotations;
			if (Array.isArray(annotations)) {
				for (const ref of annotations) note += getChildDeep(record(record(ref).body).dom);
			}
		}

		// Users annotations
		if (!note && response.annotation) {
			note = getChildDeep(record(annotation.body).dom);
		}

		// Users comments
		if (!note && response.annotation && annotation.top_comment) {
			note += getChildDeep(record(record(annotation.top_comment).body).dom);
		}
		note = note.replace(/\n\n\n?/, "\n");

		return note;
	}

	function fetchHTML(url: string, signal?: AbortSignal): Promise<string> {
		return requestLyrics(
			() =>
				new Promise<string>((resolve, reject) => {
					const request = JSON.stringify({
						method: "GET",
						uri: url,
					});

					window.sendCosmosRequest({
						request,
						persistent: false,
						onSuccess: resolve,
						onFailure: reject,
					});
				}),
			signal,
		);
	}

	async function fetchLyricsVersion(
		results: readonly GeniusVersion[],
		index: number,
		signal?: AbortSignal,
	): Promise<string | null> {
		const result = results[index];
		if (!result) {
			console.warn(result);
			return null;
		}

		const site = await fetchHTML(result.url, signal);
		const body = record(JSON.parse(site)).body;
		if (typeof body !== "string" || !body) {
			return null;
		}

		let lyrics = "";
		const parser = new DOMParser();
		const htmlDoc = parser.parseFromString(body, "text/html");
		const lyricsDiv = htmlDoc.querySelectorAll('div[data-lyrics-container="true"]');

		for (const i of lyricsDiv) {
			lyrics += `${i.innerHTML}<br>`;
		}

		if (!lyrics?.length) {
			console.warn("forceError");
			return null;
		}

		return lyrics;
	}

	async function fetchLyrics(
		info: Pick<TrackInfo, "title" | "artist">,
		signal?: AbortSignal,
	): Promise<{ lyrics: string | null; versions: GeniusVersion[] }> {
		const titles = new Set([info.title]);

		const titleNoExtra = removeExtraInfo(info.title);
		titles.add(titleNoExtra);
		titles.add(removeSongFeat(info.title));
		titles.add(removeSongFeat(titleNoExtra));

		let lyrics: string | null = null;
		let hits: GeniusVersion[] = [];
		for (const title of titles) {
			const query = new URLSearchParams({ per_page: "20", q: `${info.artist} ${title}` });
			const url = `https://genius.com/api/search/song?${query.toString()}`;

			const geniusSearch = record(await getLyricsResponse(url, signal));
			const sections = record(geniusSearch.response).sections;
			const rawHits = Array.isArray(sections) ? record(sections[0]).hits : undefined;
			hits = Array.isArray(rawHits)
				? rawHits.flatMap((item) => {
						const result = record(record(item).result);
						return typeof result.full_title === "string" && typeof result.url === "string"
							? [{ title: result.full_title, url: result.url }]
							: [];
					})
				: [];

			if (!hits.length) {
				continue;
			}

			lyrics = await fetchLyricsVersion(hits, 0, signal);
			break;
		}

		if (!lyrics) {
			return { lyrics: null, versions: [] };
		}

		return { lyrics, versions: hits };
	}

	return { fetchLyrics, getNote, fetchLyricsVersion };
})();
