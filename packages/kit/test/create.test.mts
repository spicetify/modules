/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { runCreate } from "../src/create.ts";
import { KIT_DEPENDENCY_RANGE, KIT_VERSION } from "../src/version.ts";

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
	assert.equal(pkg.devDependencies["@spicetify/kit"], KIT_DEPENDENCY_RANGE);
	assert.match(pkg.engines.node, />=22/);
});

test("release-managed kit version matches package.json", () => {
	const pkg = JSON.parse(readFileSync(path.join(KIT, "package.json"), "utf8"));
	assert.equal(KIT_VERSION, pkg.version);
});

test("extension scaffold (no css) still ships a testable logic.ts", async () => {
	const root = freshRoot();
	await runCreate(["demo-ext", "--template", "extension"], root);
	const logic = readFileSync(path.join(root, "demo-ext", "logic.ts"), "utf8");
	assert.match(logic, /export function nowPlaying/);
});

test("JavaScript scaffolds use the stdlib client capability boundary", async () => {
	for (const template of ["basic", "extension", "app"] as const) {
		const root = freshRoot();
		await runCreate([`demo-client-${template}`, "--template", template], root);
		const source = readFileSync(path.join(root, `demo-client-${template}`, "mod.tsx"), "utf8");
		assert.match(source, /\bclient\.player\b/);
		assert.doesNotMatch(source, /\bSpicetify\./);
	}
});

test("basic scaffold places its topbar button through the registrar helper", async () => {
	const root = freshRoot();
	await runCreate(["demo-button", "--template", "basic"], root);
	const source = readFileSync(path.join(root, "demo-button", "mod.tsx"), "utf8");
	assert.match(source, /registrar\.placeButton\("topbar-right"/);
	assert.doesNotMatch(source, /TopbarRightButton|registrar\.register\(\s*"topbarRightButton"/);
});

test("theme template: passes checkModule with zero findings (css-only skip)", async () => {
	const root = freshRoot();
	await runCreate(["demo-theme", "--template", "theme"], root);
	const { checkModule } = await import("../src/check.ts");
	const findings = checkModule(path.join(root, "demo-theme"));
	assert.equal(findings.length, 0, JSON.stringify(findings));
});

test("theme template: check-only scripts, no TypeScript or React devDeps, no test seam", async () => {
	const root = freshRoot();
	await runCreate(["demo-theme", "--template", "theme"], root);
	const project = path.join(root, "demo-theme");
	const pkg = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8"));
	assert.equal(pkg.scripts.check, "spicetify-kit check .");
	assert.equal(pkg.devDependencies["@spicetify/kit"], KIT_DEPENDENCY_RANGE);
	assert.equal(pkg.scripts.test, undefined);
	const dd = Object.keys(pkg.devDependencies ?? {});
	assert.ok(!dd.includes("typescript") && !dd.some((d) => d.includes("react")), `unexpected devDeps: ${dd}`);
	assert.equal(existsSync(path.join(project, "tsconfig.json")), false);
	assert.equal(existsSync(path.join(project, "test")), false);
});

test("theme template: css-only shape converges with from-theme (tags, entries, dependencies)", async () => {
	const root = freshRoot();
	await runCreate(["demo-theme", "--template", "theme"], root);
	const project = path.join(root, "demo-theme");
	const meta = JSON.parse(readFileSync(path.join(project, "metadata.json"), "utf8"));
	assert.deepEqual(meta.tags, ["theme"]);
	assert.deepEqual(meta.entries, { css: "index.css" });
	assert.deepEqual(meta.dependencies, {});
	assert.equal(existsSync(path.join(project, "index.ts")), false);
	assert.equal(existsSync(path.join(project, "mod.tsx")), false);
	assert.equal(existsSync(path.join(project, "color.ini")), true);
	assert.equal(existsSync(path.join(project, "index.css")), true);
});
