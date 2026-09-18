/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../stdlib/lib/test-setup.mts";
import assert from "node:assert/strict";
import { it } from "node:test";
import { createProviders } from "./index.ts";

const providers = createProviders({
	trackDurationMs: () => 180000,
	simplifyChinese: async (value) => value,
	spicetifyVersion: () => undefined,
});
const track = {
	uri: "spotify:track:test",
	title: "Song / One?",
	artist: "Artist & Two",
	album: "Album",
	duration: 180000,
};

it("loads plain lyrics with encoded artist/title and credits Lyrics.ovh", async (t) => {
	t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
		assert.equal(input, "https://api.lyrics.ovh/v1/Artist%20%26%20Two/Song%20%2F%20One%3F");
		assert.ok(init.signal instanceof AbortSignal);
		return Response.json({ lyrics: "First line\r\n\r\nSecond line" });
	});
	const result = await providers.lyricsovh(track);
	assert.equal(result.uri, track.uri);
	assert.equal(result.provider, "Lyrics.ovh");
	assert.equal(result.synced, null);
	assert.equal(result.karaoke, null);
	assert.deepEqual(result.unsynced, [{ text: "First line" }, { text: "" }, { text: "Second line" }]);
});

it("returns no lyrics for HTTP errors, invalid JSON, malformed and empty responses", async (t) => {
	for (const response of [
		Response.json({ error: "No lyrics found" }, { status: 404 }),
		new Response("unavailable", { status: 503 }),
		new Response("not json"),
		Response.json(null),
		Response.json({ lyrics: 123 }),
		Response.json({ lyrics: "  \n " }),
	]) {
		const mock = t.mock.method(globalThis, "fetch", async () => response);
		const result = await providers.lyricsovh(track);
		assert.equal(result.unsynced, null);
		assert.equal(result.error, "No lyrics");
		mock.mock.restore();
	}
});

it("does not start a request after cancellation", async (t) => {
	const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ lyrics: "Late lyrics" }));
	const result = await providers.lyricsovh(track, AbortSignal.abort());
	assert.equal(fetch.mock.callCount(), 0);
	assert.equal(result.unsynced, null);
});

it("returns no lyrics when a provider request fails", async (t) => {
	t.mock.method(globalThis, "fetch", async () => {
		throw new TypeError("Network error");
	});
	assert.equal((await providers.lyricsovh(track)).error, "No lyrics");
});

it("retries a missing edition title with the existing title-cleanup helper", async (t) => {
	const calls: string[] = [];
	t.mock.method(globalThis, "fetch", async (url: string) => {
		calls.push(url);
		return calls.length === 1
			? Response.json({ error: "No lyrics found" }, { status: 404 })
			: Response.json({ lyrics: "Found the original song" });
	});
	const result = await providers.lyricsovh({ ...track, title: "Let It Be - Remastered 2009" });
	assert.deepEqual(calls, [
		"https://api.lyrics.ovh/v1/Artist%20%26%20Two/Let%20It%20Be%20-%20Remastered%202009",
		"https://api.lyrics.ovh/v1/Artist%20%26%20Two/Let%20It%20Be",
	]);
	assert.deepEqual(result.unsynced, [{ text: "Found the original song" }]);
});

it("does not retry edition titles on server errors or after cancellation", async (t) => {
	for (const cancel of [false, true]) {
		const controller = new AbortController();
		const fetch = t.mock.method(globalThis, "fetch", async () => {
			if (cancel) controller.abort();
			return Response.json({}, { status: cancel ? 404 : 503 });
		});
		await providers.lyricsovh({ ...track, title: "Let It Be - Remastered 2009" }, controller.signal);
		assert.equal(fetch.mock.callCount(), 1);
		fetch.mock.restore();
	}
});
