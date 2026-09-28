/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { isSourceChange } from "../src/dev.ts";

describe("isSourceChange", () => {
	it("ignores the build output, node_modules, and dot-dirs inside a standalone project", () => {
		const root = path.resolve("/project");
		const out = path.join(root, "dist");
		assert.equal(isSourceChange("mod.tsx", root, out), true);
		assert.equal(isSourceChange(path.join("test", "a.test.mts"), root, out), true);
		assert.equal(isSourceChange(path.join("dist", "my-mod@0.1.0", "index.js"), root, out), false);
		assert.equal(isSourceChange(path.join("node_modules", "x", "y.js"), root, out), false);
		assert.equal(isSourceChange(path.join(".git", "HEAD"), root, out), false);
	});

	it("keeps every source when the output lives outside the module dir", () => {
		const root = path.resolve("/repo");
		assert.equal(isSourceChange("mod.tsx", path.join(root, "modules", "x"), path.join(root, "dist")), true);
	});
});
