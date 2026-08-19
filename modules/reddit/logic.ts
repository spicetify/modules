/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const DEFAULT_SUBREDDITS = ["spotify", "makemeaplaylist", "SpotifyPlaylists", "music", "edm", "popheads"];
export const SORTS = ["hot", "new", "top", "controversial", "rising"] as const;
export const TIMES = ["hour", "day", "week", "month", "year", "all"] as const;

export type Sort = (typeof SORTS)[number];
export type Time = (typeof TIMES)[number];
export type SpotifyKind = "playlist" | "album" | "track";

export interface FeedPost {
	uri: string;
	kind: SpotifyKind;
	postTitle: string;
}

export interface RedditItem extends FeedPost {
	title: string;
	subtitle: string;
	imageUrl: string;
	followers?: number;
}

export interface CacheShape {
	v: number;
	fetchedAt: number;
	items: RedditItem[];
}

const SPOTIFY_PATH = /^(?:intl-[a-z-]+\/)?(playlist|album|track)\/([A-Za-z0-9]+)(?:\/|$)/i;
const SPOTIFY_URI = /^spotify:(playlist|album|track):([A-Za-z0-9]+)$/i;

export function normalizeSubreddit(value: string): string | null {
	const normalized = value.trim().replace(/^r\//i, "");
	return /^[A-Za-z0-9_]{2,21}$/.test(normalized) ? normalized : null;
}

export function readSubreddits(raw: string | null): string[] {
	try {
		const parsed = JSON.parse(raw ?? "null");
		if (!Array.isArray(parsed)) return [...DEFAULT_SUBREDDITS];
		const unique = [...new Set(parsed.map((item) => (typeof item === "string" ? normalizeSubreddit(item) : null)))];
		const valid = unique.filter((item): item is string => item !== null).slice(0, 24);
		return valid.length ? valid : [...DEFAULT_SUBREDDITS];
	} catch {
		return [...DEFAULT_SUBREDDITS];
	}
}

export function buildFeedUrl(subreddit: string, sort: Sort, time: Time): string {
	const url = new URL(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.rss`);
	url.searchParams.set("limit", "100");
	if (sort === "top" || sort === "controversial") url.searchParams.set("t", time);
	return url.toString();
}

export function spotifyUri(value: string): { uri: string; kind: SpotifyKind } | null {
	const direct = value.match(SPOTIFY_URI);
	if (direct) {
		const kind = direct[1].toLowerCase() as SpotifyKind;
		return { kind, uri: `spotify:${kind}:${direct[2]}` };
	}
	try {
		const url = new URL(value);
		if (url.hostname !== "open.spotify.com" && url.hostname !== "play.spotify.com") return null;
		const match = url.pathname.replace(/^\//, "").match(SPOTIFY_PATH);
		if (!match) return null;
		const kind = match[1].toLowerCase() as SpotifyKind;
		return { kind, uri: `spotify:${kind}:${match[2]}` };
	} catch {
		return null;
	}
}

export function parseRedditFeed(xml: string, Parser: typeof DOMParser = DOMParser): FeedPost[] {
	const document = new Parser().parseFromString(xml, "text/xml");
	if (document.querySelector("parsererror")) throw new Error("Reddit returned invalid Atom XML");

	const posts: FeedPost[] = [];
	const seen = new Set<string>();
	for (const entry of document.querySelectorAll("entry")) {
		const postTitle = entry.querySelector("title")?.textContent?.trim() || "Shared on Reddit";
		const markup = entry.querySelector("content")?.textContent ?? "";
		const content = new Parser().parseFromString(markup, "text/html");
		const match = [...content.querySelectorAll<HTMLAnchorElement>("a[href]")]
			.map((anchor) => spotifyUri(anchor.href))
			.find((item) => item !== null);
		if (match && !seen.has(match.uri)) {
			seen.add(match.uri);
			posts.push({ ...match, postTitle });
		}
	}
	return posts;
}

export function imageUrl(raw?: string): string {
	if (!raw) return "";
	if (raw.startsWith("spotify:image:")) return `https://i.scdn.co/image/${raw.slice(14)}`;
	if (raw.startsWith("spotify:mosaic:")) return `https://mosaic.scdn.co/640/${raw.slice(15).replaceAll(":", "")}`;
	return raw;
}

export function retryAfterMs(headers: Pick<Headers, "get">, now = Date.now()): number | null {
	const retryAfter = headers.get("retry-after");
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
		const timestamp = Date.parse(retryAfter);
		if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - now);
	}
	if (headers.get("x-ratelimit-remaining") === "0") {
		const seconds = Number(headers.get("x-ratelimit-reset"));
		if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	}
	return null;
}

export function validateCache(value: unknown, version: number): CacheShape | null {
	const cache = value as CacheShape | null;
	if (!cache || cache.v !== version || !Number.isFinite(cache.fetchedAt) || !Array.isArray(cache.items)) return null;
	return cache.items.every(
		(item) =>
			item &&
			typeof item.uri === "string" &&
			(item.kind === "playlist" || item.kind === "album" || item.kind === "track") &&
			typeof item.title === "string" &&
			typeof item.subtitle === "string" &&
			typeof item.imageUrl === "string",
	)
		? cache
		: null;
}
