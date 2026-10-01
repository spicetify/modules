/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const SCANNED = ["packages/kit/src", "scripts"];
const SOURCE = /\.[cm]?[jt]sx?$/;
// Legacy `tags` is read only by kindOfMeta and its in-page twin, which
// packages/kit/test/push.test.mts holds equal to it.
const ALLOWED = new Set(["packages/kit/src/vault-metadata.ts", "scripts/kind-of-meta.test.mts"]);
const TAGS_READ = /\.tags\b|\[\s*["'`]tags["'`]\s*\]/;

function sources(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const full = path.join(directory, entry);
		if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : sources(full);
		return SOURCE.test(entry) ? [full] : [];
	});
}

test("kit and scripts read a module's kind only through kindOfMeta", () => {
	const reads: string[] = [];
	for (const directory of SCANNED) {
		for (const file of sources(path.join(root, directory))) {
			const relative = path.relative(root, file).split(path.sep).join("/");
			if (ALLOWED.has(relative)) continue;
			readFileSync(file, "utf8")
				.split("\n")
				.forEach((line, index) => {
					if (TAGS_READ.test(line)) reads.push(`${relative}:${index + 1}: ${line.trim()}`);
				});
		}
	}
	assert.deepEqual(reads, [], "use kindOfMeta from packages/kit/src/vault-metadata.ts");
});
