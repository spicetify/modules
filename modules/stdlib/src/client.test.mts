import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { client } from "./client.ts";

const globalRecord = globalThis as unknown as Record<string, unknown>;
const originalRuntime = globalRecord.Spicetify;

afterEach(() => {
	if (originalRuntime === undefined) delete globalRecord.Spicetify;
	else globalRecord.Spicetify = originalRuntime;
});

test("client capabilities resolve lazily from the current runtime", () => {
	const runtimeKeys = {
		player: "Player",
		platform: "Platform",
		storage: "LocalStorage",
		uri: "URI",
		cosmos: "CosmosAsync",
		corsProxy: "CORSProxy",
		graphQL: "GraphQL",
		locale: "Locale",
		icons: "SVGIcons",
		keyboard: "Keyboard",
		mousetrap: "Mousetrap",
		contextMenu: "ContextMenu",
		popupModal: "PopupModal",
		config: "Config",
		modules: "Modules",
		react: "React",
		reactDOM: "ReactDOM",
		tippy: "Tippy",
		tippyProps: "TippyProps",
		playbar: "Playbar",
		notify: "showNotification",
	} as const;
	const runtime: Record<string, { marker: string }> = Object.fromEntries(
		Object.values(runtimeKeys).map((key) => [key, { marker: key }]),
	);
	globalRecord.Spicetify = runtime;

	for (const [capability, runtimeKey] of Object.entries(runtimeKeys)) {
		assert.equal(client[capability as keyof typeof client], runtime[runtimeKey]);
	}

	const replacement = { marker: "replacement" };
	runtime.Player = replacement;
	assert.equal(client.player, replacement);
});

test("client capabilities fail with a targeted error when the wrapper is absent", () => {
	delete globalRecord.Spicetify;
	assert.throws(() => client.player, /Spicetify client runtime is unavailable/);
});
