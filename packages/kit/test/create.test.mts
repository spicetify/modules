/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { runCreate } from "../src/create.ts";

const KIT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(path.dirname(KIT));

// Scaffold under the repo so a generated `import "happy-dom"` resolves by
// walking up to the repo's node_modules (ESM ignores NODE_PATH).
const tmpRoots: string[] = [];
function freshRoot(): string {
	const root = mkdtempSync(path.join(REPO, ".kit-create-test-"));
	tmpRoots.push(root);
	return root;
}
after(() => {
	for (const r of tmpRoots) rmSync(r, { recursive: true, force: true });
});

const TEMPLATES = ["basic", "extension", "app"] as const;

for (const template of TEMPLATES) {
	const name = `demo-${template}`;

	test(`create --template ${template}: the generated starter test passes`, async () => {
		const root = freshRoot();
		await runCreate([name, "--template", template], root);
		// Clear NODE_TEST_CONTEXT so the nested runner reports normally (a
		// child node --test otherwise suppresses its own summary), and force
		// the tap reporter for a stable `# pass`/`# fail` line to assert on.
		const env = { ...process.env };
		delete env.NODE_TEST_CONTEXT;
		const out = execFileSync("node", ["--test", "--test-reporter=tap", `test/${name}.test.mts`], {
			cwd: path.join(root, name),
			env,
			encoding: "utf8",
		});
		assert.match(out, /# pass 1/);
		assert.match(out, /# fail 0/);
	});

	test(`create --template ${template}: starter test imports logic.ts, never mod.tsx or client URLs`, async () => {
		const root = freshRoot();
		await runCreate([name, "--template", template], root);
		const testSrc = readFileSync(path.join(root, name, "test", `${name}.test.mts`), "utf8");
		assert.doesNotMatch(testSrc, /mod\.tsx|mod\.js/);
		assert.doesNotMatch(testSrc, /\/modules\//);
		assert.doesNotMatch(testSrc, /https?:\/\//);
		assert.match(testSrc, /from "\.\.\/logic\.ts"/);
	});
}

test("scaffold package.json: escaped-double-quote test script, happy-dom devDep, node engine", async () => {
	const root = freshRoot();
	await runCreate(["demo-pkg", "--template", "basic"], root);
	const pkg = JSON.parse(readFileSync(path.join(root, "demo-pkg", "package.json"), "utf8"));
	assert.equal(pkg.scripts.test, 'node --test "test/*.test.mts"');
	assert.ok(pkg.devDependencies["happy-dom"], "happy-dom is a devDependency");
	assert.match(pkg.engines.node, />=22/);
});

test("extension scaffold (no css) still ships a testable logic.ts", async () => {
	const root = freshRoot();
	await runCreate(["demo-ext", "--template", "extension"], root);
	const logic = readFileSync(path.join(root, "demo-ext", "logic.ts"), "utf8");
	assert.match(logic, /export function nowPlaying/);
});
