/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kitRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli && existsSync(npmCli), "run this smoke through `npm exec -- node ...`");
const workspace = mkdtempSync(path.join(tmpdir(), "spicetify-kit-create-"));

function run(command, args, cwd, env = process.env) {
	execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

function runNpm(args, cwd) {
	run(process.execPath, [npmCli, ...args], cwd);
}

function packKit() {
	runNpm(["run", "prepack"], kitRoot);
	const output = execFileSync(
		process.execPath,
		[npmCli, "pack", "--json", "--ignore-scripts", "--pack-destination", workspace],
		{
			cwd: kitRoot,
			encoding: "utf8",
		},
	);
	const packed = JSON.parse(output);
	assert.equal(packed.length, 1, "npm pack must produce exactly one kit artifact");
	return path.join(workspace, packed[0].filename);
}

function usePackedKit(project, tarball) {
	const packagePath = path.join(project, "package.json");
	const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
	const relativeTarball = path.relative(project, tarball).split(path.sep).join("/");
	manifest.devDependencies["@spicetify/kit"] = `file:${relativeTarball}`;
	writeFileSync(packagePath, `${JSON.stringify(manifest, null, "\t")}\n`);
}

function verifyScaffold(template, tarball) {
	const name = `smoke-${template}`;
	run(
		process.execPath,
		[path.join(kitRoot, "bin", "spicetify-kit.js"), "create", name, "--template", template],
		workspace,
	);
	const project = path.join(workspace, name);
	usePackedKit(project, tarball);
	runNpm(["install", "--no-audit", "--no-fund", "--package-lock=false"], project);
	runNpm(["run", "check"], project);
	const manifest = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8"));
	if (manifest.scripts.test) runNpm(["test"], project);
	runNpm(["run", "build"], project);
	assert.ok(
		existsSync(path.join(project, "dist", `${name}@0.1.0`, "spicetify-module.json")),
		`${template} scaffold did not produce a module build`,
	);
}

try {
	const tarball = packKit();
	verifyScaffold("basic", tarball);
	verifyScaffold("theme", tarball);
	console.log(`kit create smoke passed on ${process.platform}`);
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
