import "../stdlib/lib/test-setup.mts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { afterEach, test } from "node:test";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { createModuleQueryClient } from "../stdlib/query.ts";
import { LyricsQueries } from "./queries.ts";
import { ProviderGenius } from "./providers/genius.ts";
import { GENIUS, CONFIG, UNSYNCED } from "./config.ts";
import type { GeniusVersion, ProviderResult } from "./types.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const noop = "const Component = () => null;";
const exposure = `
export * as React from ${JSON.stringify(import.meta.resolve("react"))};
export const client = { player: { data: { item: null }, origin: { _events: { addListener() {}, removeListener() {} } } }, notify() {} };
export const createRegistrar = () => ({});
${noop}
export { Component as NavLink, Component as PlaybarButton };
`;
const entry = new URL("./mod.tsx", import.meta.url);
const components: Record<string, string[]> = {
	"./options-menu.tsx": ["AdjustmentsMenu", "TranslationMenu"],
	"./tab-bar.tsx": ["TopBarContent"],
	"./settings.tsx": ["LyricsPlusSettings", "openLyricsPlusAppearanceSettings"],
	"./pages.tsx": [
		"GeniusPage",
		"LoadingIcon",
		"LyricsBackground",
		"SyncedExpandedLyricsPage",
		"SyncedLyricsPage",
		"UnsyncedLyricsPage",
	],
	"/modules/stdlib/lib/primitives.js": ["SettingsSection", "Tooltip"],
};
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "/modules/stdlib/mod.ts")
			return { url: `data:text/javascript,${encodeURIComponent(exposure)}`, shortCircuit: true };
		if (specifier === "/modules/stdlib/query.ts")
			return { url: new URL("../stdlib/query.ts", import.meta.url).href, shortCircuit: true };
		const names = context.parentURL === entry.href ? components[specifier] : undefined;
		if (names)
			return {
				url: `data:text/javascript,${encodeURIComponent(noop + names.map((name) => `export { Component as ${name} };`).join(""))}`,
				shortCircuit: true,
			};
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url === entry.href)
			return { format: "module", source: stripTypeScriptTypes(readFileSync(entry, "utf8")), shortCircuit: true };
		return nextLoad(url, context);
	},
});
const { LyricsContainer } = await import("./mod.tsx");
hooks.deregister();
class Container extends LyricsContainer {
	override render() {
		return null;
	}
}
const roots: Root[] = [];
const cleanups: (() => void | Promise<void>)[] = [];
const originalFetch = ProviderGenius.fetchLyricsVersion;
const initialVisual = { ...CONFIG.visual };
async function mount() {
	const queries = new LyricsQueries(createModuleQueryClient({ defer: (fn) => cleanups.push(fn) }));
	const ref = React.createRef<Container>();
	const root = createRoot(document.createElement("div"));
	roots.push(root);
	await React.act(async () =>
		root.render(React.createElement(Container, { ref, queries, signal: new AbortController().signal })),
	);
	assert.ok(ref.current);
	return { container: ref.current, queries };
}
afterEach(async () => {
	await React.act(async () => roots.splice(0).forEach((root) => root.unmount()));
	await Promise.all(cleanups.splice(0).map((fn) => fn()));
	ProviderGenius.fetchLyricsVersion = originalFetch;
	Object.assign(CONFIG.visual, initialVisual);
});

test("Genius columns complete independently and reject superseded versions in the same column", async () => {
	const pending = new Map<number, (value: string) => void>();
	ProviderGenius.fetchLyricsVersion = (_items, index) => new Promise((resolve) => pending.set(index, resolve));
	const { container } = await mount();
	await React.act(async () => container.setState({ mode: GENIUS }));
	const versions: GeniusVersion[] = [0, 1, 2].map((i) => ({ title: String(i), url: String(i) }));
	let first: Promise<void>, second: Promise<void>, latest: Promise<void>;
	await React.act(async () => {
		first = container.onVersionChange(versions, 0);
		second = container.onVersionChange2(versions, 1);
		latest = container.onVersionChange(versions, 2);
	});
	await React.act(async () => {
		pending.get(2)?.("latest primary");
		pending.get(1)?.("secondary");
		pending.get(0)?.("obsolete primary");
		await Promise.all([first, second, latest]);
	});
	assert.equal(container.state.genius, "latest primary");
	assert.equal(container.state.genius2, "secondary");
});

test("same-track mode races cannot overwrite the latest result and automatic selection restores a remembered mode", async () => {
	const { container, queries } = await mount();
	CONFIG.visual.colorful = false;
	container.fetchTempo = async () => {};
	container.resetDelay = () => {};
	const track = {
		uri: "spotify:track:test",
		metadata: { title: "Track", artist_name: "Artist", album_title: "Album", duration: 1000 },
	};
	container.currentTrackUri = track.uri;
	const pending = new Map<number, (value: ProviderResult) => void>();
	container.tryServices = (info, mode = -1) => new Promise((resolve) => pending.set(mode, resolve));
	let first: Promise<void>, latest: Promise<void>;
	await React.act(async () => {
		first = container.fetchLyrics(track, 1);
		latest = container.fetchLyrics(track, 2);
	});
	await React.act(async () => {
		pending.get(2)?.({ uri: track.uri, provider: "new", unsynced: [{ text: "new" }] });
		pending.get(1)?.({ uri: track.uri, provider: "old", synced: [{ text: "old", startTime: 0 }] });
		await Promise.all([first, latest]);
	});
	assert.equal(container.state.provider, "new");
	queries.rememberMode(track.uri, UNSYNCED);
	container.tryServices = async (info, mode) => {
		assert.equal(mode, UNSYNCED);
		return { uri: info.uri, provider: "remembered", unsynced: [{ text: "saved" }] };
	};
	await React.act(async () => container.fetchLyrics(track, -1));
	assert.equal(container.state.explicitMode, UNSYNCED);
});
