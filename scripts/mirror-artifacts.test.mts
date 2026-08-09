/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Mirroring runs on every push, so it has to be idempotent: a second pass
// must not stack duplicate URLs onto entries it already handled.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mirrorAsset, mirrorTag, mirrorUrl, needsMirror } from "./mirror-artifacts.ts";

describe("mirror-artifacts", () => {
	it("names one release per module and one asset per version", () => {
		assert.equal(mirrorTag("lyrics-plus"), "mirror/lyrics-plus");
		assert.equal(mirrorAsset("lyrics-plus", "1.2.0"), "lyrics-plus@1.2.0.zip");
		assert.match(
			mirrorUrl("lyrics-plus", "1.2.0"),
			/releases\/download\/mirror\/lyrics-plus\/lyrics-plus@1\.2\.0\.zip$/,
		);
	});

	it("mirrors an unmirrored artifact once and never again", () => {
		const upstream = ["https://github.com/author/mod/releases/download/1.0.0/mod@1.0.0.zip"];
		assert.equal(needsMirror("mod", "1.0.0", upstream), true);
		assert.equal(needsMirror("mod", "1.0.0", [...upstream, mirrorUrl("mod", "1.0.0")]), false);
	});

	it("leaves inline entries alone", () => {
		assert.equal(needsMirror("snippet-x", "1.0.0", []), false);
	});

	it("does not copy what this repository already hosts", () => {
		// Everything published from here already lives in our releases, so
		// the whole existing catalog is a no-op rather than 114 uploads.
		const ours = ["https://github.com/spicetify/modules/releases/download/trashbin@0.1.0/trashbin@0.1.0.zip"];
		assert.equal(needsMirror("trashbin", "0.1.0", ours), false);
	});
});
