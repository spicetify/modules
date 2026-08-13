/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const modulesRoot = new URL("../modules/", import.meta.url);
const legacyButtonPattern = /(?:Spicetify\.(?:Playbar|Topbar)|client\.(?:playbar|topbar))\.Button/;

test("first-party modules place buttons through a registrar", async () => {
	const moduleEntries = await readdir(modulesRoot, { withFileTypes: true });
	const offenders: string[] = [];

	for (const entry of moduleEntries) {
		if (!entry.isDirectory() || entry.name === "stdlib") continue;
		const moduleRoot = new URL(`${entry.name}/`, modulesRoot);
		const files = await readdir(moduleRoot, { recursive: true, withFileTypes: true });

		for (const file of files) {
			if (!file.isFile() || !/\.(?:ts|tsx)$/.test(file.name) || file.name.includes(".test.")) continue;
			const filePath = path.join(file.parentPath, file.name);
			const source = await readFile(filePath, "utf8");
			if (legacyButtonPattern.test(source)) offenders.push(path.relative(modulesRoot.pathname, filePath));
		}
	}

	assert.deepEqual(offenders.sort(), []);
});
