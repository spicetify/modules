/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	lyricsReplacementReady,
	mountLyricsPlaybarStyle,
	mountLyricsPlaybarStyleWhenReady,
	watchLyricsHistory,
	type LyricsHistory,
} from "./playbar-lifecycle.ts";

describe("watchLyricsHistory", () => {
	it("waits for late History, follows locations, and removes its listener", () => {
		let history: LyricsHistory | undefined;
		let retry: (() => void) | undefined;
		let unlistened = false;
		let listener: ((location: { pathname: string }) => void) | undefined;
		const paths: string[] = [];
		const ready: LyricsHistory[] = [];
		const cancelCalls: unknown[] = [];

		const dispose = watchLyricsHistory(
			() => history,
			(value) => ready.push(value),
			(pathname) => paths.push(pathname),
			(callback) => {
				retry = callback;
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
			(timer) => cancelCalls.push(timer),
		);
		assert.equal(ready.length, 0);

		history = {
			location: { pathname: "/" },
			listen(callback) {
				listener = callback;
				return () => {
					unlistened = true;
				};
			},
			push() {},
			goBack() {},
		};
		retry?.();
		listener?.({ pathname: "/lyrics-plus" });

		assert.deepEqual(ready, [history]);
		assert.deepEqual(paths, ["/", "/lyrics-plus"]);
		dispose();
		assert.equal(unlistened, true);
		assert.deepEqual(cancelCalls, [1]);
	});

	it("stops polling after the bounded attempt budget", () => {
		const retries: Array<() => void> = [];
		watchLyricsHistory(
			() => undefined,
			() => assert.fail("History never becomes ready"),
			() => assert.fail("no location can arrive"),
			(callback) => {
				retries.push(callback);
				return retries.length as unknown as ReturnType<typeof setTimeout>;
			},
			() => {},
			3,
		);
		for (const retry of retries) retry();
		assert.equal(retries.length, 2);
	});
});

describe("mountLyricsPlaybarStyle", () => {
	it("stays absent until the replacement button can render", () => {
		assert.equal(lyricsReplacementReady(true, null), false);
		mountLyricsPlaybarStyleWhenReady(document, "/lyrics-plus", true, null);
		assert.equal(document.querySelector("style.lyrics-plus\\:visual\\:playbar-button"), null);
	});

	it("conditionally adopts and cleans up the replacement style once ready", () => {
		const history = { location: { pathname: "/" }, listen() {}, push() {}, goBack() {} };
		const dispose = mountLyricsPlaybarStyleWhenReady(document, "/lyrics-plus", true, history);
		assert.ok(document.querySelector("style.lyrics-plus\\:visual\\:playbar-button"));
		if (typeof dispose === "function") dispose();
		assert.equal(document.querySelector("style.lyrics-plus\\:visual\\:playbar-button"), null);
	});

	it("removes the adopted style during cleanup", () => {
		const dispose = mountLyricsPlaybarStyle(document, "/lyrics-plus");
		const style = document.querySelector("style.lyrics-plus\\:visual\\:playbar-button");
		assert.ok(style?.textContent?.includes('li[data-id="/lyrics-plus"]'));
		dispose();
		assert.equal(document.contains(style), false);
	});
});
