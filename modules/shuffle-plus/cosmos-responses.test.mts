import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArtistLikedTracks, parseShowEpisodes } from "./cosmos-responses.ts";

test("shuffle keeps only playable links from collection and show responses", () => {
	assert.deepEqual(
		parseArtistLikedTracks({
			item: [
				{ trackMetadata: { playable: true, link: "spotify:track:one" } },
				{ trackMetadata: { playable: false } },
				{ trackMetadata: {} },
			],
		}),
		["spotify:track:one"],
	);
	assert.deepEqual(parseArtistLikedTracks({}), []);
	assert.deepEqual(
		parseShowEpisodes({
			items: [
				{ episodePlayState: { isPlayable: true }, episodeMetadata: { link: "spotify:episode:one" } },
				{ episodePlayState: { isPlayable: false } },
				{ episodePlayState: {} },
			],
		}),
		["spotify:episode:one"],
	);
});

test("shuffle rejects malformed lists and playable entries before queueing", () => {
	assert.throws(() => parseArtistLikedTracks({ item: {} }), /Invalid shuffle/);
	assert.throws(
		() => parseArtistLikedTracks({ item: [{ trackMetadata: { playable: true, link: 1 } }] }),
		/Invalid shuffle/,
	);
	assert.throws(() => parseShowEpisodes({ items: [null] }), /Invalid shuffle/);
	assert.throws(() => parseShowEpisodes({ items: [{ episodePlayState: { isPlayable: "yes" } }] }), /Invalid shuffle/);
});
