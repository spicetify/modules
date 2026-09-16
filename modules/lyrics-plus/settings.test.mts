/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { afterEach, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { transformSync } from "rolldown/experimental";
import { CONFIG, type ProviderKey } from "./config.ts";
import { ProviderMusixmatch } from "./providers/musixmatch.ts";
import type { SettingItem } from "./settings.tsx";

Object.assign(globalThis, {
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: window.requestAnimationFrame.bind(window),
	cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});
const exposure = `
export * as React from ${JSON.stringify(import.meta.resolve("react"))};
export * as ReactDOM from ${JSON.stringify(import.meta.resolve("react-dom"))};
export const client = {};
export const displayModal = () => {};
`;
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "/modules/stdlib/mod.ts" || specifier === "../src/expose/React.ts") {
			return { url: `data:text/javascript,${encodeURIComponent(exposure)}`, shortCircuit: true };
		}
		if (specifier === "/modules/stdlib/lib/primitives.js") {
			return { url: new URL("../stdlib/lib/primitives.tsx", import.meta.url).href, shortCircuit: true };
		}
		if (specifier === "/modules/stdlib/lib/primitives-classes.js") {
			return { url: new URL("../stdlib/lib/primitives-classes.ts", import.meta.url).href, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url.startsWith("file:") && url.endsWith(".tsx")) {
			const filename = fileURLToPath(url);
			const result = transformSync(filename, readFileSync(filename, "utf8"), { jsx: { runtime: "automatic" } });
			assert.equal(result.errors.length, 0);
			return { format: "module", source: result.code, shortCircuit: true };
		}
		return nextLoad(url, context);
	},
});
const { OptionList, ServiceList, saveVisualSetting } = await import("./settings.tsx");
const { TranslationMenu } = await import("./options-menu.tsx");
hooks.deregister();

const roots: Root[] = [];
const initialVisual = { ...CONFIG.visual };
async function render(element: React.ReactElement) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	await React.act(async () => root.render(element));
	return {
		container,
		update: async (next: React.ReactElement) => {
			await React.act(async () => root.render(next));
		},
	};
}

async function click(element: HTMLElement | null) {
	assert.ok(element);
	await React.act(async () => element.click());
}

async function selectValue(select: HTMLSelectElement | null, value: string) {
	assert.ok(select);
	await React.act(async () => {
		select.value = value;
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

afterEach(async () => {
	await React.act(async () => roots.splice(0).forEach((root) => root.unmount()));
	document.body.replaceChildren();
	Object.assign(CONFIG.visual, initialVisual);
	localStorage.clear();
});

it("replaces select options when props change and saves the new selection", async () => {
	const initial: SettingItem[] = [{ kind: "select", key: "alignment", desc: "Alignment", options: { left: "Left" } }];
	const { container, update } = await render(
		React.createElement(OptionList, { items: initial, onChange: saveVisualSetting }),
	);
	assert.deepEqual(
		Array.from(container.querySelectorAll("option"), (option) => option.value),
		["left"],
	);
	const changed: SettingItem[] = [
		{ ...initial[0], kind: "select", key: "alignment", options: { center: "Center", right: "Right" } },
	];
	await update(React.createElement(OptionList, { items: changed, onChange: saveVisualSetting }));
	assert.deepEqual(
		Array.from(container.querySelectorAll("option"), (option) => option.value),
		["center", "right"],
	);
	await selectValue(container.querySelector("select"), "right");
	assert.equal(CONFIG.visual.alignment, "right");
	assert.equal(localStorage.getItem("lyrics-plus:visual:alignment"), "right");
});

it("adjusts numeric settings within bounds and saves booleans from toggles", async () => {
	CONFIG.visual["font-size"] = 32;
	CONFIG.visual.translate = false;
	const items: SettingItem[] = [
		{ kind: "adjust", key: "font-size", desc: "Font size", min: 30, max: 34, step: 2 },
		{ kind: "toggle", key: "translate", desc: "Convert" },
	];
	const { container } = await render(React.createElement(OptionList, { items, onChange: saveVisualSetting }));
	const increase = container.querySelector<HTMLButtonElement>('button[aria-label="Increase Font size"]');
	await click(increase);
	assert.equal(CONFIG.visual["font-size"], 34);
	assert.equal(increase?.disabled, true);
	await click(increase);
	assert.equal(CONFIG.visual["font-size"], 34);
	await click(container.querySelector('button[aria-label="Decrease Font size"]'));
	assert.equal(CONFIG.visual["font-size"], 32);
	await click(container.querySelector('input[aria-label="Convert"]'));
	assert.equal(CONFIG.visual.translate, true);
	assert.equal(localStorage.getItem("lyrics-plus:visual:translate"), "true");
});

it("moves providers through shared ordering controls and toggles the chosen provider", async () => {
	const orders: ProviderKey[][] = [];
	const toggles: { name: ProviderKey; enabled: boolean }[] = [];
	const { container } = await render(
		React.createElement(ServiceList, {
			itemsList: ["spotify", "netease"],
			onListChange: (items) => orders.push([...items]),
			onToggle: (name, enabled) => toggles.push({ name, enabled }),
		}),
	);
	await click(container.querySelector('button[aria-label="Move Spotify down"]'));
	assert.deepEqual(orders, [["netease", "spotify"]]);
	assert.deepEqual(
		Array.from(container.querySelectorAll('input[type="checkbox"]'), (input) => input.getAttribute("aria-label")),
		["Netease provider", "Spotify provider"],
	);
	await click(container.querySelector('input[aria-label="Spotify provider"]'));
	assert.deepEqual(toggles, [{ name: "spotify", enabled: !CONFIG.providers.spotify.on }]);
	assert.equal(container.querySelector<HTMLButtonElement>('button[aria-label="Move Netease up"]')?.disabled, true);
});

it("refreshes translation choices from props and makes provider and conversion selections exclusive", async (t) => {
	t.mock.method(ProviderMusixmatch, "getLanguages", async () => ({ en: "English", ja: "Japanese" }));
	CONFIG.visual.translate = true;
	const initial = {
		friendlyLanguage: "japanese",
		hasTranslation: { musixmatch: false, netease: false },
		musixmatchLanguages: ["en"],
	};
	const { container, update } = await render(React.createElement(TranslationMenu, initial));
	await click(container.querySelector('button[aria-label="Conversions"]'));
	const providerSelect = () => document.querySelector<HTMLSelectElement>('[role="dialog"] select');
	assert.deepEqual(
		Array.from(providerSelect()?.options ?? [], (option) => option.value),
		["none", "musixmatchTranslation:en"],
	);
	await update(React.createElement(TranslationMenu, { ...initial, musixmatchLanguages: ["ja"] }));
	assert.deepEqual(
		Array.from(providerSelect()?.options ?? [], (option) => option.value),
		["none", "musixmatchTranslation:ja"],
	);
	await selectValue(providerSelect(), "musixmatchTranslation:ja");
	assert.equal(CONFIG.visual.translate, false);
	assert.equal(CONFIG.visual["musixmatch-translation-language"], "ja");
	assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="Convert"]')?.checked, false);
	await click(document.querySelector('input[aria-label="Convert"]'));
	assert.equal(CONFIG.visual.translate, true);
	assert.equal(CONFIG.visual["translate:translated-lyrics-source"], "none");
	assert.equal(providerSelect()?.value, "none");
});
