/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./primitives.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../index.scss", import.meta.url), "utf8");

test("SettingsToggleRow associates its label with the native checkbox", () => {
	assert.match(source, /const id = React\.useId\(\)/);
	assert.match(source, /<SettingsRow label=\{props\.label\} htmlFor=\{id\}>/);
	assert.match(source, /<Toggle\s+id=\{id\}/);
	assert.match(
		source,
		/<label className=\{SETTINGS_ROW_TEXT_CLASS\} htmlFor=\{props\.htmlFor\}>\s*\{props\.label\}\s*<\/label>/,
	);
});

test("Toggle wires native classes, names, changes, and keyboard activation", () => {
	assert.match(source, /<label className=\{TOGGLE_CLASSES\.wrapper\}>/);
	assert.match(source, /className=\{TOGGLE_CLASSES\.input\}/);
	assert.match(source, /id=\{props\.id\}/);
	assert.match(source, /aria-label=\{props\.ariaLabel\}/);
	assert.match(source, /disabled=\{props\.disabled\}/);
	assert.match(source, /onKeyDown=\{activateToggleOnKeyDown\}/);
	assert.match(source, /className=\{TOGGLE_CLASSES\.indicatorWrapper\}/);
	assert.match(source, /className=\{TOGGLE_CLASSES\.indicator\}/);
});

test("the deprecated standalone toggle class remains styled for patch compatibility", () => {
	assert.match(styles, /\.spicetify-toggle\s*\{/);
	assert.match(styles, /\.spicetify-toggle:checked\s*\{/);
});

test("direct Toggle consumers associate every settings label", () => {
	for (const path of ["../../shuffle-plus/mod.tsx", "../../trashbin/mod.tsx"]) {
		const consumer = readFileSync(new URL(path, import.meta.url), "utf8");
		const toggleRows = [...consumer.matchAll(/<SettingsRow\b([\s\S]*?)<\/SettingsRow>/g)].filter((match) =>
			match[0].includes("<Toggle"),
		);
		assert.ok(toggleRows.length > 0, `${path} should contain toggle rows`);
		for (const row of toggleRows) {
			const htmlFor = row[0].match(/htmlFor="([^"]+)"/)?.[1];
			assert.ok(htmlFor, `${path} toggle row needs htmlFor`);
			assert.match(row[0], new RegExp(`id="${htmlFor}"`), `${path} toggle id must match its label`);
		}
	}
});
