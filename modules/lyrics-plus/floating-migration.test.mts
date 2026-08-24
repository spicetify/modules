/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const directory = new URL("./", import.meta.url);
const files = (await readdir(directory, { recursive: true })).filter((path) => /\.(?:ts|tsx)$/.test(path)).map(String);
const source = (await Promise.all(files.map((path) => readFile(new URL(path, directory), "utf8")))).join("\n");
const optionsMenu = await readFile(new URL("./options-menu.tsx", import.meta.url), "utf8");
const metadata = JSON.parse(await readFile(new URL("./metadata.json", import.meta.url), "utf8"));

describe("Lyrics Plus owned floating-surface migration", () => {
	it("uses stdlib-owned tooltips and popovers", () => {
		assert.match(optionsMenu, /\bPopover\b/);
		assert.match(optionsMenu, /\bPopoverMenu\b/);
		assert.match(optionsMenu, /\bPopoverMenuItem\b/);
		assert.doesNotMatch(source, /Spicetify\.(?:ReactComponent|Mousetrap|CosmosAsync)/);
		assert.match(source, /configureLyricsClient\(client\)/);
	});

	it("declares the stdlib version that introduced floating surfaces", () => {
		assert.equal(metadata.version, "0.2.4");
		assert.equal(metadata.dependencies.stdlib, "^1.10.0");
	});
});
