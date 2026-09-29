/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = async (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const metadata = JSON.parse(await read("../metadata.json"));
const kit = JSON.parse(await read("../../../packages/kit/package.json"));

// True when a version is 1.10.0 or newer, compared numerically per part.
// Build metadata is stripped (it has no precedence), and a prerelease of the
// floor deliberately does not satisfy it.
const satisfiesFloor = (version: string): boolean => {
	const [core] = version.split("+");
	const [release] = core!.split("-");
	const parts = release!.split(".").map(Number);
	const floor = [1, 10, 0];
	for (let i = 0; i < floor.length; i++) {
		if ((parts[i] ?? 0) !== floor[i]) return (parts[i] ?? 0) > floor[i]!;
	}
	return version.includes("-") ? false : true;
};

describe("stdlib-owned floating surfaces", () => {
	it("ships the floating API through the current kit", () => {
		// The API landed in 1.10.0; the kit must scaffold against a stdlib
		// that carries it, and the pin must track the workspace version.
		assert.ok(satisfiesFloor(metadata.version), `stdlib ${metadata.version} predates the floating API`);
		assert.equal(kit.spicetify.stdlibVersion, metadata.version);
	});
});
