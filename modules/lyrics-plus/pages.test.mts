/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { afterEach, it } from "node:test";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

const playback = { position: 0, playing: true };
const shortcuts: { operation: string; arguments: unknown[] }[] = [];
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, lyricsPageTest: { playback, shortcuts } });
const exposure = `
export * as React from ${JSON.stringify(import.meta.resolve("react"))};
const { playback, shortcuts } = globalThis.lyricsPageTest;
export const client = {
 player: { getProgress: () => playback.position, isPlaying: () => playback.playing },
 locale: { get: () => "Lyrics provided by" },
 icons: { search: "" },
 platform: { History: { location: { pathname: "/lyrics-plus" } } },
 mousetrap: () => ({
  bind: (...args) => shortcuts.push({ operation: "bind", arguments: args }),
  unbind: (...args) => shortcuts.push({ operation: "unbind", arguments: args }),
 }),
};
`;
const pageUrl = new URL("./pages.tsx", import.meta.url);
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "/modules/stdlib/mod.ts" && context.parentURL === pageUrl.href) {
			return { url: `data:text/javascript,${encodeURIComponent(exposure)}`, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url === pageUrl.href) {
			return {
				format: "module",
				source: stripTypeScriptTypes(readFileSync(pageUrl, "utf8")),
				shortCircuit: true,
			};
		}
		return nextLoad(url, context);
	},
});
const { SearchBar, SyncedLyricsPage, SyncedExpandedLyricsPage, VersionSelector } = await import("./pages.tsx");
hooks.deregister();

const roots: Root[] = [];
async function render(element: React.ReactElement) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	await React.act(async () => root.render(element));
	return container;
}

afterEach(async () => {
	await React.act(async () => roots.splice(0).forEach((root) => root.unmount()));
	document.body.replaceChildren();
	playback.position = 0;
	playback.playing = true;
	shortcuts.length = 0;
});

it("renders both synchronized views while lyrics are empty", async () => {
	await render(React.createElement(SyncedLyricsPage, { lyrics: [] }));
	await render(React.createElement(SyncedExpandedLyricsPage, { lyrics: [] }));
	assert.equal(document.querySelectorAll(".lyrics-idling-indicator").length, 2);
});

it("selects Genius versions with a numeric index", async () => {
	const selections: number[] = [];
	const versions = [
		{ title: "Original", url: "first" },
		{ title: "Alternate", url: "second" },
	];
	const container = await render(
		React.createElement(VersionSelector, {
			items: versions,
			index: 0,
			callback: (items, index) => {
				assert.equal(items, versions);
				selections.push(index);
			},
		}),
	);
	const select = container.querySelector("select");
	assert.ok(select);
	await React.act(async () => {
		select.value = "1";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	assert.deepEqual(selections, [1]);
});

it("mounts without Spotify scroll containers and removes each keyboard shortcut", async () => {
	await render(React.createElement(SearchBar));
	assert.equal(shortcuts.filter(({ operation }) => operation === "bind").length, 5);
	await React.act(async () => roots.splice(0).forEach((root) => root.unmount()));
	assert.deepEqual(
		shortcuts.filter(({ operation }) => operation === "unbind").map(({ arguments: args }) => args),
		[["mod+shift+f"], ["mod+shift+f"], ["enter"], ["shift+enter"], ["esc"]],
	);
});

it("keeps expanded lyrics fixed while paused and advances after playback resumes", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const container = await render(
		React.createElement(SyncedExpandedLyricsPage, {
			lyrics: [
				{ text: "First", startTime: 0 },
				{ text: "Second", startTime: 1000 },
			],
		}),
	);
	const activeText = () =>
		container.querySelector(".lyrics-lyricsContainer-LyricsLine-active:not(.lyrics-idling-indicator)")?.textContent;
	assert.equal(activeText(), "First");
	playback.position = 1500;
	playback.playing = false;
	await React.act(async () => t.mock.timers.tick(50));
	assert.equal(activeText(), "First");
	playback.playing = true;
	await React.act(async () => t.mock.timers.tick(50));
	assert.equal(activeText(), "Second");
});
