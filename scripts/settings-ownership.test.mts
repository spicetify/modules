/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const settingsPageModules = [
	"adblock",
	"auto-skip-explicit",
	"auto-skip-video",
	"hide-window-controls",
	"lyrics-plus",
	"popup-lyrics",
	"shuffle-plus",
	"trashbin",
] as const;

// These features own a visible surface where their controls have immediate,
// obvious effects. Their preferences stay next to that surface rather than
// being duplicated on the global settings page.
const contextualSettingsModules = ["full-app-display", "new-releases"] as const;

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
					const metadata = JSON.parse(read(`modules/${id}/metadata.json`)) as { kind?: string };
					return metadata.kind === "app" || metadata.kind === "extension";
				} catch {
					return false;
				}
			})
			.sort();
		assert.deepEqual([...audited].sort(), discovered);
	});

	it("registers global and integration settings with Spicetify Settings", () => {
		for (const id of settingsPageModules) {
			const source = read(`modules/${id}/mod.tsx`);
			assert.match(source, /register\(\s*["']settings(?:Row|Section)["']/, `${id} must register its settings`);
		}
	});

	it("keeps Full App Display settings on its overlay", () => {
		const source = read("modules/full-app-display/mod.tsx");
		assert.match(source, /onContextMenu:\s*openConfig/);
		assert.match(source, /displayModal\(\{/);
		assert.doesNotMatch(source, /(?:Spicetify\.PopupModal|client\.popupModal)/);
		assert.doesNotMatch(source, /register\(\s*["']settingsSection["']/);
	});

	it("keeps New Releases filters in its feature-page toolbar", () => {
		const source = read("modules/new-releases/mod.tsx");
		assert.doesNotMatch(source, /register\(\s*["']settingsSection["']/);
		assert.match(source, /<Chip\b/);
	});

	it("splits lyrics appearance from global provider settings", () => {
		const lyrics = read("modules/lyrics-plus/settings.tsx");
		assert.match(lyrics, /function LyricsPlusAppearanceSettings/);
		assert.match(lyrics, /function openLyricsPlusAppearanceSettings/);
		assert.match(lyrics, /function LyricsPlusSettings/);
		assert.match(lyrics, /title:\s*["']Lyrics Plus appearance["']/);
		assert.match(lyrics, /react\.createElement\("h3"[^\n]+"Providers"\)/);
		assert.match(lyrics, /react\.createElement\(SettingsProviderRow/);
		assert.match(lyrics, /react\.createElement\(SettingsTextInputRow/);

		const popup = read("modules/popup-lyrics/mod.tsx");
		assert.match(popup, /PopupLyricsAppearanceSettings/);
		assert.match(popup, /title:\s*["']Popup Lyrics appearance["']/);
		assert.match(popup, /register\(\s*["']settingsSection["']/);
		assert.match(popup, /<SettingsSection title="Popup Lyrics">/);
		assert.match(popup, /<h3 className=\{SETTINGS_SECTION_SUBHEADING_CLASS\}>Providers<\/h3>/);
		assert.match(popup, /<SettingsProviderRow/);
		assert.match(popup, /<SettingsTextInputRow/);
	});
});
