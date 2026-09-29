/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const metadata = JSON.parse(await readFile(new URL("../../metadata.json", import.meta.url), "utf8"));
const kitPackage = JSON.parse(
	await readFile(new URL("../../../../packages/kit/package.json", import.meta.url), "utf8"),
);

describe("owned panel public API", () => {
	it("ships through the current kit", () => {
		// The kit's pin must track the workspace stdlib, whatever its
		// version; a literal here breaks on every routine bump.
		assert.equal(kitPackage.spicetify.stdlibVersion, metadata.version);
	});
});
