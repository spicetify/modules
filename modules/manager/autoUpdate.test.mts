/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareCliVersions, pendingCliUpdate } from "./autoUpdate.ts";

describe("compareCliVersions", () => {
	it("orders betas numerically and a release above its betas", () => {
		assert.ok(compareCliVersions("3.0.0-beta.10", "3.0.0-beta.9") > 0);
		assert.ok(compareCliVersions("3.0.0", "3.0.0-beta.22") > 0);
		assert.ok(compareCliVersions("3.0.1-beta.1", "3.0.0") > 0);
		assert.equal(compareCliVersions("3.0.0-beta.21", "3.0.0-beta.21"), 0);
		assert.equal(compareCliVersions("3.0.0-beta.21+build.4", "3.0.0-beta.21"), 0);
		assert.ok(compareCliVersions("3.0.0-rc.1", "3.0.0-beta.30") > 0, "identifiers compare as text");
	});
});

describe("pendingCliUpdate", () => {
	it("names an installed release newer than the one this client was applied with", () => {
		const info = { version: "3.0.0-beta.22", autoUpdate: true };
		assert.equal(pendingCliUpdate(info, "3.0.0-beta.21"), "3.0.0-beta.22");
		assert.equal(pendingCliUpdate(info, "3.0.0-beta.22"), null, "already applied");
		assert.equal(pendingCliUpdate(info, "3.0.0-beta.23"), null, "applied by a newer build");
	});

	it("stays quiet when either version is unknown", () => {
		assert.equal(pendingCliUpdate(null, "3.0.0-beta.21"), null);
		assert.equal(pendingCliUpdate({ version: null, autoUpdate: null }, "3.0.0-beta.21"), null);
		assert.equal(pendingCliUpdate({ version: "3.0.0-beta.22", autoUpdate: true }, undefined), null);
	});
});
