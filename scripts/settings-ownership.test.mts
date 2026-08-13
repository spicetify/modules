/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const configurableModules = [
	"adblock",
	"auto-skip-explicit",
	"auto-skip-video",
	"full-app-display",
	"hide-window-controls",
	"lyrics-plus",
	"new-releases",
	"popup-lyrics",
	"shuffle-plus",
	"trashbin",
] as const;

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
		const audited = new Set<string>([...configurableModules, ...modulesWithoutCoreSettings]);
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

	it("registers every configurable app and extension with Spicetify Settings", () => {
		for (const id of configurableModules) {
			const source = read(`modules/${id}/mod.tsx`);
			assert.match(source, /register\(\s*["']settings(?:Row|Section)["']/, `${id} must register its settings`);
		}
	});

	it("does not keep configuration modals in first-party modules", () => {
		for (const id of ["full-app-display", "popup-lyrics"] as const) {
			const source = read(`modules/${id}/mod.tsx`);
			assert.doesNotMatch(
				source,
				/popupModal\.display\(\{\s*title:\s*["'][^"']+["']/s,
				`${id} must not own a settings modal`,
			);
		}
	});

	it("keeps New Releases preferences out of its feature-page toolbar", () => {
		const source = read("modules/new-releases/mod.tsx");
		assert.match(source, /register\(\s*["']settingsSection["']/);
		assert.doesNotMatch(source, /<Chip\b/);
	});
});
