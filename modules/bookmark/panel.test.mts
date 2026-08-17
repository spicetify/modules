/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const moduleSource = await readFile(new URL("./mod.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("./index.scss", import.meta.url), "utf8");
const metadata = JSON.parse(await readFile(new URL("./metadata.json", import.meta.url), "utf8"));

describe("Bookmark owned panel", () => {
	it("registers a namespaced sidebar panel and toggles it from the topbar", () => {
		assert.match(moduleSource, /registrar\.registerPanel\(\{/);
		assert.match(moduleSource, /id:\s*"bookmarks"/);
		assert.match(moduleSource, /label:\s*"Bookmarks"/);
		assert.match(moduleSource, /width:\s*\{\s*default:\s*380,\s*min:\s*320,\s*max:\s*480\s*\}/);
		assert.match(moduleSource, /onClick:\s*\(\)\s*=>\s*panelController\.toggle\(\)/);
	});

	it("delegates positioning, Escape, and teardown to stdlib", () => {
		assert.doesNotMatch(moduleSource, /document\.body\.append\(LIST\.container\)/);
		assert.doesNotMatch(moduleSource, /changePosition|addEventListener\("keydown"/);
		assert.doesNotMatch(styles, /#bookmark-spicetify|position:\s*fixed|position:\s*absolute/);
	});

	it("uses a scrollable theme-native panel layout", () => {
		assert.match(styles, /\.bookmark-panel-mount\s*\{[^}]*height:\s*100%/s);
		assert.match(styles, /\.bookmark-panel-actions\s*\{[^}]*display:\s*grid/s);
		assert.match(styles, /\.bookmark-panel-list\s*\{[^}]*overflow:\s*hidden auto/s);
		assert.match(styles, /\.bookmark-panel-empty\s*\{/);
		assert.match(moduleSource, /linkButton\.className = "bookmark-card-link"/);
		assert.doesNotMatch(moduleSource, /inner\.setAttribute\("role",\s*"link"\)/);
	});

	it("ships as a Bookmark feature release against the owned-panel stdlib", () => {
		assert.equal(metadata.version, "0.4.1");
		assert.equal(metadata.dependencies.stdlib, "^1.10.0");
		assert.match(metadata.description, /sidebar panel/i);
	});
});
