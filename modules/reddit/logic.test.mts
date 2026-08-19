/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Window } from "happy-dom";

import {
	DEFAULT_SUBREDDITS,
	MAX_SUBREDDITS,
	buildFeedUrl,
	imageUrl,
	normalizeSubreddit,
	parseRedditFeed,
	readSubreddits,
	retryAfterMs,
	spotifyUri,
	validateCache,
} from "./logic.ts";

const Parser = new Window().DOMParser;
const atom = (entries: string) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
const entry = (title: string, content: string) =>
	`<entry><title>${title}</title><content type="html">${content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</content></entry>`;

describe("Reddit feed URL and subreddit config", () => {
	it("builds RSS URLs with time only for time-aware sorts", () => {
		assert.equal(
			buildFeedUrl("spotify", "top", "month"),
			"https://www.reddit.com/r/spotify/top.rss?limit=100&t=month",
		);
		assert.equal(buildFeedUrl("popheads", "hot", "year"), "https://www.reddit.com/r/popheads/hot.rss?limit=100");
	});

	it("normalizes and bounds stored subreddit names", () => {
		assert.equal(normalizeSubreddit(" r/Spotify_2 "), "Spotify_2");
		assert.equal(normalizeSubreddit("bad/name"), null);
		assert.deepEqual(readSubreddits('["spotify","spotify","r/music","bad/name"]'), ["spotify", "music"]);
		assert.deepEqual(readSubreddits("broken"), DEFAULT_SUBREDDITS);
	});

	it("dedupes case-insensitively, keeping the first spelling", () => {
		assert.deepEqual(readSubreddits('["SpotifyPlaylists","spotifyplaylists","music"]'), [
			"SpotifyPlaylists",
			"music",
		]);
	});

	it("caps the stored list at the add limit", () => {
		const many = JSON.stringify(Array.from({ length: 30 }, (_, i) => `sub_${i}`));
		assert.equal(readSubreddits(many).length, MAX_SUBREDDITS);
	});
});

describe("Spotify links", () => {
	it("normalizes open, international and URI forms", () => {
		assert.deepEqual(spotifyUri("https://open.spotify.com/playlist/abc123?si=x"), {
			kind: "playlist",
			uri: "spotify:playlist:abc123",
		});
		assert.deepEqual(spotifyUri("https://open.spotify.com/intl-pt/track/xyz789"), {
			kind: "track",
			uri: "spotify:track:xyz789",
		});
		assert.deepEqual(spotifyUri("spotify:album:album1"), { kind: "album", uri: "spotify:album:album1" });
		assert.equal(spotifyUri("https://example.com/track/nope"), null);
	});

	it("extracts the first supported link per Atom entry and deduplicates", () => {
		const xml = atom(
			entry(
				"Playlist post",
				'<a href="https://example.com">x</a><a href="https://open.spotify.com/playlist/list1?si=x">listen</a>',
			) +
				entry("Duplicate", '<a href="https://open.spotify.com/playlist/list1">same</a>') +
				entry("Track post", '<a href="https://open.spotify.com/track/track1">listen</a>'),
		);
		assert.deepEqual(parseRedditFeed(xml, Parser as unknown as typeof DOMParser), [
			{ kind: "playlist", uri: "spotify:playlist:list1", postTitle: "Playlist post" },
			{ kind: "track", uri: "spotify:track:track1", postTitle: "Track post" },
		]);
	});

	it("rejects invalid XML", () => {
		assert.throws(
			() => parseRedditFeed("<feed><entry>", Parser as unknown as typeof DOMParser),
			/invalid Atom XML/,
		);
	});

	it("rejects well-formed XML that is not an Atom feed", () => {
		// A block page or interstitial parses cleanly; caching it as an
		// empty feed would show "no links" for the whole TTL.
		assert.throws(
			() => parseRedditFeed("<html><body>blocked</body></html>", Parser as unknown as typeof DOMParser),
			/not return an Atom feed/,
		);
	});
});

describe("cache and response helpers", () => {
	it("maps Spotify art URIs to browser-loadable CDN URLs", () => {
		assert.equal(imageUrl("spotify:image:abc"), "https://i.scdn.co/image/abc");
		assert.equal(imageUrl("spotify:mosaic:a:b:c"), "https://mosaic.scdn.co/640/abc");
		assert.equal(imageUrl("https://example.com/a.png"), "https://example.com/a.png");
	});

	it("derives cooldowns from standard and Reddit rate-limit headers", () => {
		assert.equal(retryAfterMs(new Headers({ "retry-after": "12" })), 12000);
		assert.equal(retryAfterMs(new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "30" })), 30000);
		// Reddit sends the remaining budget as a float.
		assert.equal(retryAfterMs(new Headers({ "x-ratelimit-remaining": "0.0", "x-ratelimit-reset": "30" })), 30000);
		assert.equal(retryAfterMs(new Headers({ "x-ratelimit-remaining": "42.0", "x-ratelimit-reset": "30" })), null);
		assert.equal(retryAfterMs(new Headers()), null);
	});

	it("accepts only the current complete cache shape", () => {
		const good = {
			v: 1,
			fetchedAt: 10,
			items: [
				{
					uri: "spotify:playlist:a",
					kind: "playlist",
					postTitle: "post",
					title: "title",
					subtitle: "subtitle",
					imageUrl: "",
				},
			],
		};
		assert.equal(validateCache(good, 1), good);
		assert.equal(validateCache({ ...good, v: 2 }, 1), null);
		assert.equal(validateCache({ ...good, items: [{ uri: 4 }] }, 1), null);
	});

	it("rejects tampered optional fields and future timestamps", () => {
		const item = {
			uri: "spotify:playlist:a",
			kind: "playlist",
			postTitle: "post",
			title: "title",
			subtitle: "subtitle",
			imageUrl: "",
		};
		const good = { v: 1, fetchedAt: 10, items: [item] };
		assert.equal(validateCache({ ...good, items: [{ ...item, followers: 12 }] }, 1)?.items.length, 1);
		// followers: null would throw in render (`followers.toLocaleString()`).
		assert.equal(validateCache({ ...good, items: [{ ...item, followers: null }] }, 1), null);
		assert.equal(validateCache({ ...good, items: [{ ...item, postTitle: 4 }] }, 1), null);
		assert.equal(validateCache({ ...good, fetchedAt: 50 }, 1, 40), null);
	});
});
