/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEXT_THEME_CSS = path.join(HERE, "..", "themes", "text", "index.css");

describe("text theme track info", () => {
	it("keeps the artist in the first grid column when a relocated badge is present", () => {
		const css = readFileSync(TEXT_THEME_CSS, "utf8");

		assert.match(
			css,
			/\.main-nowPlayingWidget-trackInfo\s+\.main-trackList-enhanced:not\(:empty\)\s*~\s*\.main-trackInfo-artists\s*\{[^}]*grid-column-start:\s*badges\s*;/s,
		);
	});

	it("spaces the save and video icons on the same 32px pitch as the right-side controls", () => {
		const css = readFileSync(TEXT_THEME_CSS, "utf8");

		assert.match(
			css,
			/\.main-nowPlayingWidget-trackInfo\s+\.main-trackInfo-xsmallBadges\s*\{[^}]*inset-inline-start:\s*calc\(100% \+ 40px\)\s*;/s,
		);
	});

	it("sizes the video glyph like the other 16px playbar icons", () => {
		const css = readFileSync(TEXT_THEME_CSS, "utf8");

		assert.match(
			css,
			/\.main-nowPlayingWidget-trackInfo\s+\.main-trackInfo-xsmallBadges\s+\[data-encore-id="icon"\]\s*\{[^}]*--encore-icon-height:\s*16px\s*!important\s*;[^}]*--encore-icon-width:\s*16px\s*!important\s*;/s,
		);
	});
});
