/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const settings = await readFile(new URL("./settings.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../stdlib/index.scss", import.meta.url), "utf8");

const appearance = settings.slice(
	settings.indexOf("export function LyricsPlusAppearanceSettings"),
	settings.indexOf("export function openLyricsPlusAppearanceSettings"),
);

describe("Lyrics Plus appearance settings", () => {
	it("uses grouped stdlib settings primitives instead of the legacy flat form", () => {
		assert.match(appearance, /<SettingsSection\s+title="Playback"/);
		assert.match(appearance, /<SettingsSection\s+title="Compact lyrics"/);
		assert.match(appearance, /<SettingsSection\s+title="Backdrop"/);
		assert.match(appearance, /<SettingsSection\s+title="Advanced text detection"/);
		assert.doesNotMatch(appearance, /type:\s*Config(?:Slider|Adjust|Selection|Input|Hotkey)/);
	});

	it("uses the stdlib capability boundary and a compact owned modal", () => {
		assert.doesNotMatch(settings, /Spicetify\.(?:CosmosAsync|Mousetrap)/);
		assert.match(settings, /client\.(?:cosmos|mousetrap)/);
		assert.doesNotMatch(settings, /isLarge:\s*true/);
	});

	it("gives settings rows responsive dialog-native layout", () => {
		assert.match(styles, /\.spicetify-dialog\s+\.x-settings-row\s*\{[^}]*grid-template-columns/s);
		assert.match(styles, /\.spicetify-dialog\s+\.x-settings-secondColumn\s*\{[^}]*justify-content:\s*flex-end/s);
	});
});
