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
		config: "Config",
		modules: "Modules",
		daemon: "Daemon",
		snackbar: "Snackbar",
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
	runtime.PopupModal = { marker: "PopupModal" };
	globalRecord.Spicetify = runtime;

	for (const [capability, runtimeKey] of Object.entries(runtimeKeys)) {
		assert.equal(client[capability as keyof typeof client], runtime[runtimeKey]);
	}

	const replacement = { marker: "replacement" };
	runtime.Player = replacement;
	assert.equal(client.player, replacement);
	assert.equal(typeof client.popupModal.display, "function");
	assert.equal(typeof client.popupModal.hide, "function");
	assert.notEqual(client.popupModal, runtime.PopupModal);
});

test("client capabilities fail with a targeted error when the wrapper is absent", () => {
	delete globalRecord.Spicetify;
	assert.throws(() => client.player, /Spicetify client runtime is unavailable/);
});

test("spicetifyVersion prefers the v3 manifest and falls back to the legacy config", () => {
	globalRecord.Spicetify = {
		Modules: { manifest: { cliVersion: "3.2.0" } },
		Config: { version: "2.40.0" },
	};
	assert.equal(client.spicetifyVersion, "3.2.0");

	globalRecord.Spicetify = { Modules: {}, Config: { version: "2.40.0" } };
	assert.equal(client.spicetifyVersion, "2.40.0");

	globalRecord.Spicetify = { Modules: {}, Config: {} };
	assert.equal(client.spicetifyVersion, undefined);
});
