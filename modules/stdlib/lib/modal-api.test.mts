/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = async (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const readJson = async (path: string) => JSON.parse(await read(path));

const consumers = ["palette-manager", "lyrics-plus", "popup-lyrics", "full-app-display"];

describe("stdlib-owned modal API", () => {
	it("requires the stdlib version that supplies the owned API", async () => {
		const stdlibMinor = Number((await readJson("../metadata.json")).version.split(".")[1]);
		assert.ok(stdlibMinor >= 8);
		for (const name of consumers) {
			const metadata = await readJson(`../../${name}/metadata.json`);
			const requiredMinor = Number(metadata.dependencies.stdlib.match(/^\^1\.(\d+)\.0$/)?.[1]);
			assert.ok(requiredMinor >= 8, `${name} must require stdlib 1.8.0 or newer`);
		}
	});
});
