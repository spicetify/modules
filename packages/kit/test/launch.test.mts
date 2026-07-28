/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { discoverSpotify } from "../src/launch.ts";
import { formatPushResult } from "../src/dev.ts";

test("discoverSpotify: macOS resolves the app bundle", () => {
	const r = discoverSpotify("darwin", {}, (p) => p === "/Applications/Spotify.app");
	assert.deepEqual(r, { kind: "macos", app: "/Applications/Spotify.app" });
});

test("discoverSpotify: Windows standalone install via APPDATA", () => {
	const env = { APPDATA: "C:\\Users\\me\\AppData\\Roaming" };
	const exe = "C:\\Users\\me\\AppData\\Roaming\\Spotify\\Spotify.exe";
	const r = discoverSpotify("win32", env, (p) => p === exe);
	assert.deepEqual(r, { kind: "windows", exe });
});

test("discoverSpotify: Windows AppX install is unsupported", () => {
	const env = { APPDATA: "C:\\roam", LOCALAPPDATA: "C:\\local" };
	const appx = "C:\\local\\Microsoft\\WindowsApps\\Spotify.exe";
	const r = discoverSpotify("win32", env, (p) => p === appx);
	assert.equal(r.kind, "appx");
});

test("discoverSpotify: Linux resolves via PATH", () => {
	const r = discoverSpotify(
		"linux",
		{},
		() => false,
		(c) => (c === "spotify" ? "/usr/bin/spotify" : null),
	);
	assert.deepEqual(r, { kind: "linux", exe: "/usr/bin/spotify" });
});

test("discoverSpotify: no binary names the searched locations per platform", () => {
	assert.throws(() => discoverSpotify("darwin", {}, () => false), /\/Applications\/Spotify\.app/);
	assert.throws(
		() => discoverSpotify("win32", { APPDATA: "C:\\roam", LOCALAPPDATA: "C:\\local" }, () => false),
		/Spotify\.exe not found/,
	);
	assert.throws(
		() =>
			discoverSpotify(
				"linux",
				{},
				() => false,
				() => null,
			),
		/not found on PATH/,
	);
});

test("formatPushResult: loader-not-ready points at spicetify apply", () => {
	const r = formatPushResult(JSON.stringify({ error: "loader not ready" }));
	assert.equal(r.ok, false);
	assert.match(r.message, /spicetify apply/);
});

test("formatPushResult: malformed result surfaces a parse note, not just a raw dump", () => {
	const r = formatPushResult("<html>503</html>");
	assert.equal(r.ok, false);
	assert.match(r.message, /not JSON/);
});

test("formatPushResult: a failed module is reported as not ok", () => {
	const r = formatPushResult(JSON.stringify({ loaded: true, failed: "boom" }));
	assert.equal(r.ok, false);
	assert.match(r.message, /failed: boom/);
});

test("formatPushResult: a loaded module is ok", () => {
	const r = formatPushResult(JSON.stringify({ loaded: true, failed: null }));
	assert.equal(r.ok, true);
	assert.equal(r.message, "loaded");
});
