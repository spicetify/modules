/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findBy, matchLast, toPascalCase } from "./util.ts";

describe("toPascalCase", () => {
	// Golden values computed against the original hooks-era data-URL
	// bundle of @std/text@1.0.4. The outputs become webpack-needle
	// registry keys (URI types, component names), so the inlined port
	// must never drift from these.
	const goldens: Array<[string, string]> = [
		["useContextMenuState", "UseContextMenuState"],
		["useNavigateStable", "UseNavigateStable"],
		["PLAYLIST_V2", "PlaylistV2"],
		["PLAYLIST", "Playlist"],
		["ALBUM", "Album"],
		["CONCERT", "Concert"],
		["trackList", "TrackList"],
		["userToplist", "UserToplist"],
		["socialsession", "Socialsession"],
		["profile-menu", "ProfileMenu"],
		["kebab-case-name", "KebabCaseName"],
		["some_snake_case", "SomeSnakeCase"],
		["HTMLElement", "HtmlElement"],
		["XMLHttpRequest", "XmlHttpRequest"],
		["queryClient", "QueryClient"],
		["PlaylistV2", "PlaylistV2"],
		["v2", "V2"],
		["A", "A"],
		["aB", "AB"],
		["AB", "Ab"],
		["ABc", "ABc"],
		["a1b2", "A1B2"],
		["  padded  ", "Padded"],
		["", ""],
		["enqueueCustomSnackbar", "EnqueueCustomSnackbar"],
		["GenericModal", "GenericModal"],
		["RightSidebar", "RightSidebar"],
	];

	for (const [input, expected] of goldens) {
		it(`maps ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
			assert.equal(toPascalCase(input), expected);
		});
	}
});

describe("findBy", () => {
	it("matches by string needle", () => {
		const xs = [
			() => 1,
			function target() {
				return "needle here";
			},
		];
		assert.equal(findBy("needle")(xs), xs[1]);
	});

	it("matches by regex and requires every test to pass", () => {
		const a = () => "alpha beta";
		const b = () => "alpha gamma";
		assert.equal(findBy(/alpha/, "gamma")([a, b]), b);
	});

	it("matches by predicate", () => {
		const xs = [1, 2, 3];
		assert.equal(findBy((x: number) => x > 2)(xs), 3);
	});

	it("survives exports whose toString throws", () => {
		// Some client exports are functions with a poisoned toString;
		// they must stringify to "" and never match, not throw.
		const hostile = new Proxy(() => {}, {
			get(target, p) {
				if (p === "toString") throw new Error("poisoned");
				return Reflect.get(target, p);
			},
		});
		const ok = function ok() {
			return "wanted";
		};
		assert.equal(findBy("wanted")([hostile, ok]), ok);
		assert.equal(findBy("anything")([hostile]), undefined);
	});
});

describe("matchLast", () => {
	it("returns the last match with capture groups", () => {
		const m = matchLast("a.useRef b.useRef c.useRef", /([a-zA-Z_$][\w$]*)\.useRef/g);
		assert.equal(m[1], "c");
	});
});
