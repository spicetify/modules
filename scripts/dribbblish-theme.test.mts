/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../modules/stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { relocateElement } from "../themes/dribbblish/logic.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEME_DIR = path.join(HERE, "..", "themes", "dribbblish");
const css = readFileSync(path.join(THEME_DIR, "index.css"), "utf8");
const mod = readFileSync(path.join(THEME_DIR, "mod.tsx"), "utf8");
const metadata = JSON.parse(readFileSync(path.join(THEME_DIR, "metadata.json"), "utf8"));

describe("dribbblish frame", () => {
	it("uses the sidebar colour as a continuous outer frame around one main surface", () => {
		assert.match(
			css,
			/html\.spicetify-themed\s+\.Root__top-container\s*\{[^}]*background-color:\s*var\(--spice-sidebar\)\s*!important\s*;[^}]*padding:\s*var\(--main-gap\)\s+var\(--main-gap\)\s+var\(--main-gap\)\s+0\s*!important\s*;/s,
		);
		assert.match(css, /\.Root__right-sidebar\s*\{[^}]*background-color:\s*var\(--spice-main\)\s*!important\s*;/s);
	});

	it("lays registered nav links out in the green rail and reserves their measured space", () => {
		assert.match(css, /#dribbblish-navlinks-rail\s*\{[^}]*position:\s*absolute\s*;/s);
		assert.match(
			css,
			/#dribbblish-navlinks-rail\s+\.spicetify-navlinks-anchor\s*\{[^}]*flex-direction:\s*column\s*;/s,
		);
		assert.match(css, /\.Root__nav-bar\s*\{[^}]*padding-top:\s*var\(--dribbblish-navlinks-reserve,\s*0px\)\s*;/s);
		assert.match(mod, /relocateElement\(navlinks,\s*rail\)/);
		assert.match(mod, /--dribbblish-navlinks-reserve/);
	});

	it("restores registered nav links to their exact sibling position", () => {
		const original = document.createElement("div");
		const before = document.createElement("span");
		const navlinks = document.createElement("div");
		const after = document.createElement("span");
		const rail = document.createElement("div");
		original.append(before, navlinks, after);
		document.body.append(original, rail);

		const restore = relocateElement(navlinks, rail);
		assert.equal(navlinks.parentElement, rail);
		restore();
		assert.deepEqual([...original.children], [before, navlinks, after]);

		original.remove();
		rail.remove();
	});

	it("removes moved links when their original surface has gone away", () => {
		const original = document.createElement("div");
		const navlinks = document.createElement("div");
		const rail = document.createElement("div");
		original.append(navlinks);
		document.body.append(original, rail);

		const restore = relocateElement(navlinks, rail);
		original.remove();
		restore();
		assert.equal(navlinks.isConnected, false);

		rail.remove();
	});
});

describe("dribbblish window controls contract", () => {
	it("requires the hide-window-controls extension", () => {
		assert.equal(metadata.dependencies["hide-window-controls"], "^0.1.4");
	});

	it("marks the requirement for the dependency and removes it on teardown", () => {
		assert.match(mod, /setAttribute\(HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE,\s*""\)/);
		assert.match(mod, /removeAttribute\(HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE\)/);
	});
});
