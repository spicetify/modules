/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deserializeColors, formatCSSKey, paletteCSS, serializePalette } from "./palette-logic.ts";

const color = (hex: string) => ({ hex, toCSS: () => hex });

describe("formatCSSKey", () => {
	it("maps snake_case palette keys onto the --spice- variables themes read", () => {
		assert.equal(formatCSSKey("main_elevated"), "--spice-main-elevated");
		assert.equal(formatCSSKey("text"), "--spice-text");
		assert.equal(formatCSSKey("a_b_c"), "--spice-a-b-c");
	});
});

describe("paletteCSS", () => {
	it("renders every entry as a css declaration in order", () => {
		const css = paletteCSS({ text: color("#ffffff"), button_active: color("#1ed760") }, "HEX");
		assert.equal(css, "--spice-text: #ffffff; --spice-button-active: #1ed760;");
	});

	it("passes the format token through to the color", () => {
		let seen: unknown;
		paletteCSS({ x: { toCSS: (f) => ((seen = f), "#000") } }, "FORMAT-TOKEN");
		assert.equal(seen, "FORMAT-TOKEN");
	});
});

describe("palette serialization", () => {
	it("stringifies each color value individually - the stored format saved palettes depend on", () => {
		const data = serializePalette("p1", "Mine", { text: { h: 1 }, base: "raw" });
		assert.deepEqual(data, { id: "p1", name: "Mine", colors: { text: '{"h":1}', base: '"raw"' } });
	});

	it("round-trips through deserializeColors with the codec injected", () => {
		const data = serializePalette("p1", "Mine", { text: { v: 42 } });
		const out = deserializeColors(data, (raw) => JSON.parse(raw));
		assert.deepEqual(out, { text: { v: 42 } });
	});

	it("hands the codec the exact stored string, so codec compat is the only compat", () => {
		const raws: string[] = [];
		deserializeColors({ id: "p", name: "n", colors: { a: '"#fff"', b: "{}" } }, (raw) => {
			raws.push(raw);
			return raw;
		});
		assert.deepEqual(raws, ['"#fff"', "{}"]);
	});
});
