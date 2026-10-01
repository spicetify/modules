/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { kindOfMeta } from "../packages/kit/src/vault-metadata.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const settingsPageModules = [
	"adblock",
	"auto-skip-explicit",
	"auto-skip-video",
	"hide-window-controls",
	"lyrics-plus",
	"popup-lyrics",
	"shuffle-plus",
	"spicetify-splash",
	"trashbin",
] as const;

// These features own a visible surface where their controls have immediate,
// obvious effects. Their preferences stay next to that surface rather than
// being duplicated on the global settings page.
const contextualSettingsModules = ["full-app-display", "new-releases", "reddit"] as const;

// These modules own content or transient UI state, not module-wide preferences.
// Keeping the list explicit forces every new first-party app/extension through
// the same ownership decision instead of letting a private settings surface slip in.
const modulesWithoutCoreSettings = [
	"bookmark",
	"keyboard-shortcut",
	"loopy-loop",
	"manager",
	"palette-manager",
	"store",
	"webnowplaying",
] as const;

describe("first-party settings ownership", () => {
	it("classifies every first-party app and extension", () => {
		const audited = new Set<string>([
			...settingsPageModules,
			...contextualSettingsModules,
			...modulesWithoutCoreSettings,
		]);
		const discovered = readdirSync(new URL("../modules/", import.meta.url))
			.filter((id) => {
				try {
					const kind = kindOfMeta(JSON.parse(read(`modules/${id}/metadata.json`)));
					return kind === "app" || kind === "extension";
				} catch {
					return false;
				}
			})
			.sort();
		assert.deepEqual([...audited].sort(), discovered);
	});
});
