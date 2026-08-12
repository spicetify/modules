/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { runFromTheme } from "../src/from-theme.ts";
import { KIT_DEPENDENCY_RANGE } from "../src/version.ts";

const roots: string[] = [];
after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("from-theme uses the release-managed kit dependency range", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "kit-from-theme-"));
	roots.push(root);
	const source = path.join(root, "Classic Theme");
	mkdirSync(source);
	writeFileSync(path.join(source, "user.css"), ":root {}\n");

	await runFromTheme([source, "--name", "migrated-theme"], root);

	const pkg = JSON.parse(readFileSync(path.join(root, "migrated-theme", "package.json"), "utf8"));
	assert.equal(pkg.devDependencies["@spicetify/kit"], KIT_DEPENDENCY_RANGE);
});
