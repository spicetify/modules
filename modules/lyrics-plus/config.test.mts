/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// CONFIG is built eagerly at import, so any test that needs specific stored
// settings seeds localStorage first and then dynamic-imports the module.

// Relative, not the /modules/* runtime alias: that alias is resolved by the
// bundler and does not exist under `node --test`.
import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { getConfig } from "./config.ts";

beforeEach(() => localStorage.clear());

describe("test harness storage", () => {
	it("exposes a working localStorage", () => {
		localStorage.setItem("probe", "value");
		assert.equal(localStorage.getItem("probe"), "value");
		localStorage.removeItem("probe");
		assert.equal(localStorage.getItem("probe"), null);
	});
});

describe("getConfig", () => {
	it('returns true for a stored "true"', () => {
		localStorage.setItem("k", "true");
		assert.equal(getConfig("k"), true);
	});

	it('returns false for a stored "false"', () => {
		localStorage.setItem("k", "false");
		assert.equal(getConfig("k"), false);
	});

	// Pinning current behaviour, not endorsing it: any non-empty value that
	// is not exactly "true" reads as false, and the default does NOT apply.
	it("returns false for any other non-empty stored value", () => {
		localStorage.setItem("k", "yes");
		assert.equal(getConfig("k", true), false);
		localStorage.setItem("k", "{}");
		assert.equal(getConfig("k", true), false);
	});

	it("returns the supplied default when the key is absent", () => {
		assert.equal(getConfig("missing"), true);
		assert.equal(getConfig("missing", false), false);
	});

	it("returns the supplied default for an empty stored value", () => {
		localStorage.setItem("k", "");
		assert.equal(getConfig("k", false), false);
		assert.equal(getConfig("k", true), true);
	});
});

describe("CONFIG", () => {
	it("exposes the documented visual defaults on clean storage", async () => {
		const { CONFIG } = await import(`./config.ts?clean=${Date.now()}`);
		assert.equal(CONFIG.visual.alignment, "center");
		assert.equal(CONFIG.visual["background-color"], "var(--spice-main)");
		assert.equal(CONFIG.visual["playbar-button"], false);
		// Numeric coercion runs after the literal.
		assert.equal(CONFIG.visual["font-size"], 32);
		assert.equal(CONFIG.visual["lines-before"], 0);
		assert.equal(CONFIG.visual["lines-after"], 2);
		assert.equal(CONFIG.locked, -1);
	});

	it("falls back to the provider keys when services-order is malformed", async () => {
		localStorage.setItem("lyrics-plus:services-order", "{not json");
		const { CONFIG } = await import(`./config.ts?malformed=${Date.now()}`);
		assert.deepEqual(CONFIG.providersOrder, Object.keys(CONFIG.providers));
		// The repaired order is written back so the next load is clean.
		assert.deepEqual(JSON.parse(localStorage.getItem("lyrics-plus:services-order")), Object.keys(CONFIG.providers));
	});

	it("falls back when services-order length does not match the provider set", async () => {
		localStorage.setItem("lyrics-plus:services-order", JSON.stringify(["lrclib"]));
		const { CONFIG } = await import(`./config.ts?short=${Date.now()}`);
		assert.equal(CONFIG.providersOrder.length, Object.keys(CONFIG.providers).length);
	});

	it("leaves the genius client-version gate to mod.tsx", async () => {
		const { CONFIG } = await import(`./config.ts?genius=${Date.now()}`);
		// config.ts must stay loadable without a client, so it reads only the
		// stored flag; mod.tsx applies the >= 1.2.31 override on import.
		assert.equal(CONFIG.providers.genius.on, true);
	});

	// The most intricate part of the moved block: three chained conditionals
	// with two storage write-backs and a force-off.
	it("upgrades a legacy musixmatchTranslation source to the prefixed form", async () => {
		localStorage.setItem("lyrics-plus:visual:translate:translated-lyrics-source", "musixmatchTranslation");
		localStorage.setItem("lyrics-plus:visual:musixmatch-translation-language", "es");
		const { CONFIG } = await import(`./config.ts?upgrade=${Date.now()}`);
		assert.equal(CONFIG.visual["translate:translated-lyrics-source"], "musixmatchTranslation:es");
		assert.equal(
			localStorage.getItem("lyrics-plus:visual:translate:translated-lyrics-source"),
			"musixmatchTranslation:es",
		);
	});

	it("downgrades a legacy source to none when no language is selected", async () => {
		localStorage.setItem("lyrics-plus:visual:translate:translated-lyrics-source", "musixmatchTranslation");
		const { CONFIG } = await import(`./config.ts?nolang=${Date.now()}`);
		assert.equal(CONFIG.visual["translate:translated-lyrics-source"], "none");
	});

	it("back-fills the language from a prefixed source", async () => {
		localStorage.setItem("lyrics-plus:visual:translate:translated-lyrics-source", "musixmatchTranslation:fr");
		const { CONFIG } = await import(`./config.ts?backfill=${Date.now()}`);
		assert.equal(CONFIG.visual["musixmatch-translation-language"], "fr");
		assert.equal(localStorage.getItem("lyrics-plus:visual:musixmatch-translation-language"), "fr");
	});

	it("forces the translate toggle off when a translation source is active", async () => {
		localStorage.setItem("lyrics-plus:visual:translate", "true");
		localStorage.setItem("lyrics-plus:visual:translate:translated-lyrics-source", "musixmatchTranslation:fr");
		const { CONFIG } = await import(`./config.ts?forceoff=${Date.now()}`);
		assert.equal(CONFIG.visual.translate, false);
		assert.equal(localStorage.getItem("lyrics-plus:visual:translate"), "false");
	});

	it("exposes all six providers", async () => {
		const { CONFIG } = await import(`./config.ts?providers=${Date.now()}`);
		assert.deepEqual(Object.keys(CONFIG.providers).sort(), [
			"genius",
			"local",
			"lrclib",
			"musixmatch",
			"netease",
			"spotify",
		]);
	});
});
