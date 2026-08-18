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

test("release-please owns both npm packages and the scaffold version source", () => {
	const config = readJson("release-please-config.json");
	assert.equal(config["release-type"], "node");
	assert.equal(config["always-link-local"], false);
	assert.deepEqual(config.plugins, [{ type: "node-workspace" }]);
	assert.ok(config.packages["packages/create-spicetify-module"]);
	assert.deepEqual(config.packages["packages/kit"]["extra-files"], [{ type: "generic", path: "src/version.ts" }]);
	assert.match(readFileSync(path.join(ROOT, "packages/kit/src/version.ts"), "utf8"), /x-release-please-version/);
});

test("npm publishing keeps OIDC isolated to the protected Node 24 job", () => {
	const workflow = readFileSync(path.join(ROOT, ".github/workflows/npm-publish.yml"), "utf8");
	assert.match(workflow, /environment: npm/);
	assert.match(workflow, /id-token: write/);
	assert.match(workflow, /node-version: "24"/);
	assert.match(workflow, /googleapis\/release-please-action@[0-9a-f]{40}/);
	assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
});

test("npm publishing generates module declarations before typechecking", () => {
	const workflow = readFileSync(path.join(ROOT, ".github/workflows/npm-publish.yml"), "utf8");
	const build = workflow.indexOf("node scripts/stitch.ts");
	const check = workflow.indexOf("pnpm check");
	assert.notEqual(build, -1, "publication must generate classmap.d.ts files");
	assert.notEqual(check, -1, "publication must typecheck the repository");
	assert.ok(build < check, "module declarations must exist before tsc runs");
});

test("npm publishing can recover a partial release without overwriting registry versions", () => {
	const workflow = readFileSync(path.join(ROOT, ".github/workflows/npm-publish.yml"), "utf8");
	assert.match(workflow, /recover_npm:/);
	assert.match(workflow, /npm view "\$package" versions --json/);
	assert.match(workflow, /gh release view "\$tag"/);
	assert.match(workflow, /if: steps\.plan\.outputs\.kit == 'true'/);
	assert.match(workflow, /if: steps\.plan\.outputs\.launcher == 'true'/);
});
