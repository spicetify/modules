/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.dirname(import.meta.dirname);
const readJson = (file: string) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));

test("release-please manifest starts from the public npm versions", () => {
	const manifest = readJson(".release-please-manifest.json");
	const kit = readJson("packages/kit/package.json");
	const launcher = readJson("packages/create-spicetify-module/package.json");
	const stdlib = readJson("modules/stdlib/metadata.json");

	assert.equal(manifest["packages/kit"], kit.version);
	assert.equal(manifest["packages/create-spicetify-module"], launcher.version);
	assert.equal(kit.spicetify.stdlibVersion, stdlib.version);
});
