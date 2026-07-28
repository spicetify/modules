/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldRebuildOnChange } from "../src/build.ts";
import { main } from "../src/cli.ts";
import { runCreate } from "../src/create.ts";

function captureLog(fn: () => Promise<void> | void): Promise<string> {
	const logs: string[] = [];
	const orig = console.log;
	console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
	return Promise.resolve(fn())
		.then(() => logs.join("\n"))
		.finally(() => {
			console.log = orig;
		});
}

test("shouldRebuildOnChange: sources rebuild; generated .d.ts and dotfiles do not", () => {
	assert.equal(shouldRebuildOnChange("mod.tsx"), true);
	assert.equal(shouldRebuildOnChange("index.scss"), true);
	assert.equal(shouldRebuildOnChange("classmap.d.ts"), false);
	assert.equal(shouldRebuildOnChange(".gitignore"), false);
	assert.equal(shouldRebuildOnChange(null), false);
});

test("create --help exits cleanly and names all four templates", async () => {
	const out = await captureLog(() => runCreate(["--help"]));
	for (const t of ["basic", "extension", "app", "theme"]) {
		assert.match(out, new RegExp(`\\b${t}\\b`), `help names ${t}`);
	}
});

test("top-level --help names every command", async () => {
	const out = await captureLog(() => main(["--help"]));
	for (const c of ["create", "check", "from-theme", "build", "dev", "pack", "vault", "install"]) {
		assert.match(out, new RegExp(`\\b${c}\\b`), `usage names ${c}`);
	}
});
