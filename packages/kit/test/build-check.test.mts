/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { buildModule } from "../src/build.ts";
import { checkModule } from "../src/check.ts";

const tmps: string[] = [];
function mk(): string {
	const d = mkdtempSync(path.join(tmpdir(), "kit-bc-"));
	tmps.push(d);
	return d;
}
after(() => {
	for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

function writeMod(dir: string, meta: object, files: Record<string, string> = {}): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(meta));
	for (const [f, c] of Object.entries(files)) writeFileSync(path.join(dir, f), c);
}

const okDeps = { stdlib: "^0.3.0" };

test("css-only module: no entry-shim finding, no index.ts required (R4)", () => {
	const dir = path.join(mk(), "theme");
	writeMod(
		dir,
		{
			name: "theme",
			tags: ["theme"],
			version: "0.1.0",
			authors: ["x"],
			description: "a theme",
			entries: { css: "index.css" },
			hasMixins: false,
			dependencies: {},
		},
		{ "index.scss": ".x{}" },
	);
	const findings = checkModule(dir);
	assert.equal(findings.filter((f) => f.rule === "entry-shim").length, 0, "no entry-shim finding for css-only");
	assert.equal(findings.filter((f) => f.severity === "error").length, 0, "no error-tier findings");
});

test("build enforces the error tier: a metadata error aborts before any dist output", async () => {
	const root = mk();
	const dir = path.join(root, "bad");
	// invalid version + missing dependencies => two error-tier findings.
	writeMod(
		dir,
		{
			name: "bad",
			tags: ["extension"],
			version: "not-a-version",
			authors: ["x"],
			description: "d",
			entries: { js: "index.js" },
			hasMixins: false,
		},
		{ "index.ts": "export function load() {}" },
	);
	const out = path.join(root, "dist");
	await assert.rejects(
		buildModule(dir, out, { path: null, key: null }, root, { check: "enforce" }),
		/error-tier finding/,
	);
	assert.equal(existsSync(path.join(out, "bad@not-a-version")), false, "no dist directory was written");
});

test("--no-check bypasses the standard check (no error-tier abort)", async () => {
	const root = mk();
	const dir = path.join(root, "bad");
	writeMod(
		dir,
		{
			name: "bad",
			tags: ["extension"],
			version: "not-a-version",
			authors: ["x"],
			description: "d",
			entries: { js: "index.js" },
			hasMixins: false,
		},
		{ "index.ts": "export function load() {}" },
	);
	// With the check off it gets past the standard check and fails later on the
	// null classmap instead — proving the check did not abort it.
	await assert.rejects(
		buildModule(dir, path.join(root, "dist"), { path: null, key: null }, root, { check: "off" }),
		(e: Error) => !/error-tier finding/.test(e.message),
	);
});

test("warn-tier findings do not make the module error-tier", () => {
	const dir = path.join(mk(), "warnish");
	// A hardcoded hashed classname is a warn-tier nudge, not an error.
	writeMod(
		dir,
		{
			name: "warnish",
			tags: ["app"],
			version: "0.1.0",
			authors: ["x"],
			description: "d",
			entries: { js: "index.js" },
			hasMixins: false,
			dependencies: okDeps,
		},
		{
			"index.ts": 'export function load() {}\nimport("./mod.js");',
			"mod.tsx": 'const c = "GsN1lSw9lhVeNJRxlXcO";\nexport default () => c;',
		},
	);
	const findings = checkModule(dir);
	assert.equal(findings.filter((f) => f.severity === "error").length, 0, "no error-tier findings");
});
