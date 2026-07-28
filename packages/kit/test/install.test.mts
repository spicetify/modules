/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { runInstall } from "../src/install.ts";
import { record } from "../src/push.ts";

const tmps: string[] = [];
function mk(): string {
	const d = mkdtempSync(path.join(tmpdir(), "kit-inst-"));
	tmps.push(d);
	return d;
}
after(() => {
	for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

test("record: builds the LocalModuleRecord shape, excluding maps and asset dirs", () => {
	const dist = mk();
	writeFileSync(path.join(dist, "metadata.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
	writeFileSync(path.join(dist, "spicetify-module.json"), JSON.stringify({ installed_version: "1.0.0" }));
	writeFileSync(path.join(dist, "index.js"), "console.log(1)");
	writeFileSync(path.join(dist, "index.js.map"), "{}");
	mkdirSync(path.join(dist, "assets"));
	writeFileSync(path.join(dist, "assets", "a.png"), "x");

	const rec = record(dist, "demo");
	assert.equal(rec.metadata.identifier, "demo");
	assert.ok(rec.sidecar);
	// Only the js file: metadata.json rides in .metadata, .map and the asset
	// dir are excluded from localStorage.
	assert.deepEqual(Object.keys(rec.files).sort(), ["index.js", "spicetify-module.json"]);
});

test("install: a dir without metadata.json fails with a named error", async () => {
	const dir = mk();
	await assert.rejects(runInstall([dir], mk()), /no metadata\.json/);
});

test("install: a missing target fails with a named error", async () => {
	await assert.rejects(runInstall([path.join(mk(), "does-not-exist")], mk()), /not found/);
});
