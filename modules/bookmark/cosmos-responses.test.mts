import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseEpisodeMetadata,
	parsePlaylistMetadata,
	parseShowMetadata,
	parseTrackMetadata,
} from "./cosmos-responses.ts";

test("bookmark parses the metadata it displays from each Cosmos endpoint", () => {
	assert.deepEqual(
		parseShowMetadata({ header: { showMetadata: { name: "Show", covers: { standardLink: "image" } } } }),
		{ title: "Show", description: "Podcast", imageUrl: "image" },
	);
	assert.deepEqual(
		parseTrackMetadata({ name: "Track", artists: [{ name: "Artist" }], album: { images: [{ url: "image" }] } }),
		{ title: "Track", description: "Artist", imageUrl: "image" },
	);
	assert.deepEqual(parseEpisodeMetadata({ name: "Episode", show: { name: "Show", images: [{ url: "image" }] } }), {
		title: "Episode",
		description: "Show episode",
		imageUrl: "image",
	});
	assert.deepEqual(parsePlaylistMetadata({ metadata: { name: "Playlist", picture: "image" } }), {
		title: "Playlist",
		description: "Playlist",
		imageUrl: "image",
	});
	assert.deepEqual(parsePlaylistMetadata({ metadata: { name: "Playlist" } }), {
		title: "Playlist",
		description: "Playlist",
		imageUrl: undefined,
	});
});

test("bookmark rejects error responses and malformed nested metadata", () => {
	for (const parse of [parseShowMetadata, parseTrackMetadata, parseEpisodeMetadata, parsePlaylistMetadata]) {
		for (const value of [null, [], { error: "unauthorized" }])
			assert.throws(() => parse(value), /Invalid bookmark/);
	}
	assert.throws(() => parseTrackMetadata({ name: "Track", artists: [], album: { images: [] } }), /Invalid bookmark/);
	assert.throws(() => parsePlaylistMetadata({ metadata: { name: {}, picture: "image" } }), /Invalid bookmark/);
});
