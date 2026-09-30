/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Disposal is one-way for the whole module graph, so it gets its own process.

import assert from "node:assert/strict";
import { it } from "node:test";

import type { VaultModule } from "./catalog.ts";
import { markDisposed } from "./runtime.ts";
import { RESUME_UPDATES_KEY, runUpdates } from "./updates.ts";

const storage = new Map<string, string>([[RESUME_UPDATES_KEY, "1"]]);
(globalThis as never as Record<string, unknown>).localStorage = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => void storage.set(key, String(value)),
	removeItem: (key: string) => void storage.delete(key),
};
(globalThis as never as Record<string, unknown>).Spicetify = {
	showNotification: () => {},
	Modules: { listLocal: () => [], list: () => [] },
};

const entry = (id: string): VaultModule => ({ id, version: "2.0.0", artifacts: ["x"], vault: "default" });

it("stops a batch once the store that runs it is disposed, leaving the rest to its successor", async () => {
	const installed: string[] = [];
	await runUpdates(
		[entry("store"), entry("a"), entry("b")],
		() => {},
		async (mod) => {
			installed.push(mod.id);
			if (mod.id === "store") markDisposed();
			return { requiresRestart: false, enabled: true };
		},
	);
	assert.deepEqual(installed, ["store"]);
	assert.equal(storage.get(RESUME_UPDATES_KEY), "1");
});
