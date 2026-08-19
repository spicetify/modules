/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { client } from "/modules/stdlib/mod.ts";
import {
	buildFeedUrl,
	imageUrl,
	parseRedditFeed,
	retryAfterMs,
	type FeedPost,
	type RedditItem,
	type Sort,
	type Time,
} from "./logic.ts";

export class FeedError extends Error {
	constructor(
		message: string,
		readonly retryAt?: number,
	) {
		super(message);
	}
}

const fallbackItem = (post: FeedPost): RedditItem => ({
	...post,
	title: post.postTitle,
	subtitle: `${post.kind[0].toUpperCase()}${post.kind.slice(1)} shared on Reddit`,
	imageUrl: "",
});

async function hydratePost(post: FeedPost): Promise<RedditItem> {
	if (post.kind !== "playlist") return fallbackItem(post);
	try {
		const metadata = await client.platform?.PlaylistAPI?.getMetadata?.(post.uri);
		if (!metadata?.name) return fallbackItem(post);
		const owner = metadata.owner?.displayName || metadata.owner?.username;
		return {
			...post,
			title: metadata.name,
			subtitle: owner ? `Playlist • ${owner}` : post.postTitle,
			imageUrl: imageUrl(metadata.images?.[0]?.url),
			followers: Number.isFinite(metadata.totalLikes) ? metadata.totalLikes : undefined,
		};
	} catch {
		return fallbackItem(post);
	}
}

async function mapPool<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
	const output = Array.from({ length: items.length }) as R[];
	let cursor = 0;
	const worker = async () => {
		while (cursor < items.length) {
			const index = cursor++;
			output[index] = await map(items[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return output;
}

export async function fetchRedditItems(
	subreddit: string,
	sort: Sort,
	time: Time,
	signal: AbortSignal,
): Promise<RedditItem[]> {
	const response = await client.corsProxy.fetch(buildFeedUrl(subreddit, sort, time), { signal });
	if (!response.ok) {
		const cooldown = retryAfterMs(response.headers);
		throw new FeedError(
			response.status === 429 ? "Reddit is rate-limiting this feed." : `Reddit returned HTTP ${response.status}.`,
			cooldown === null ? undefined : Date.now() + cooldown,
		);
	}
	const posts = parseRedditFeed(await response.text()).slice(0, 60);
	if (signal.aborted) throw new DOMException("Aborted", "AbortError");
	return mapPool(posts, 6, async (post) => {
		if (signal.aborted) throw new DOMException("Aborted", "AbortError");
		return hydratePost(post);
	});
}
