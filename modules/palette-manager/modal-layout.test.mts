/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = async (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const styles = await read("./index.scss");
const content = await read("./modal.tsx");

describe("Palette Manager owned-modal layout", () => {
	it("keeps the palette list bounded inside the dialog scroll surface", () => {
		assert.match(styles, /\.palette-modal-container\s*\{[^}]*height:\s*min\(/s);
		assert.match(styles, /\.palette-list\s*\{[^}]*overflow-y:\s*auto/s);
		assert.doesNotMatch(styles, /\.palette-fields-container\s*\{[^}]*height:\s*45vh/s);
		assert.doesNotMatch(styles, /MAP__modal|widget-generator/);
		assert.match(content, /<ul className="palette-list">[\s\S]*<ThemeSchemes\s*\/>[\s\S]*<\/ul>/);
	});
});
