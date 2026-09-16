import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { auditModuleImports, buildModuleGraph, changedModuleSelection, gitChangedFiles } from "./module-graph.ts";

const root = mkdtempSync(path.join(tmpdir(), "module-graph-"));
after(() => rmSync(root, { recursive: true, force: true }));
function fixture(id: string, code: string, dependencies: Record<string, string> = {}, collection = "modules") {
	const directory = path.join(root, collection, id);
	mkdirSync(directory, { recursive: true });
	writeFileSync(path.join(directory, "metadata.json"), JSON.stringify({ name: id, version: "1.0.0", dependencies }));
	writeFileSync(path.join(directory, "mod.ts"), code);
}

fixture("stdlib", "export const value = 1;");
fixture("provider", "export const value = 1;");
fixture(
	"consumer",
	`
import { value } from "/modules/provider/mod.js";
import type { Type } from "/modules/stdlib/mod.ts";
// import { fake } from "/modules/comment/src/private.ts";
const text = 'import("/modules/string/src/private.ts")';
export { type Type } from "/modules/stdlib/mod.ts";
type Imported = import("/modules/stdlib/mod.ts").Type;
`,
	{ provider: "*" },
);
fixture("dependent", 'import "/modules/consumer/mod.js";', { consumer: "*" }, "themes");
fixture("unrelated", "export const value = 1;");

test("builds source and metadata edges without treating strings or comments as imports", () => {
	const graph = buildModuleGraph(root);
	assert.deepEqual([...graph.modules.get("consumer")!.dependencies].sort(), ["provider", "stdlib"]);
	assert.deepEqual(auditModuleImports(graph), []);
});

test("rejects private paths and undeclared runtime imports across every import form", () => {
	fixture(
		"invalid",
		`
import type { X } from "../provider/src/private.ts";
export { value } from "/modules/provider/mod.js";
const dynamic = import(\`/modules/provider/mod.js\`);
const commonjs = require("/modules/provider/mod.js");
import assigned = require("/modules/provider/mod.js");
import "/modules/provider/../provider/src/private.ts";
`,
	);
	try {
		const findings = auditModuleImports(buildModuleGraph(root));
		assert.equal(findings.filter((finding) => finding.rule === "private-module-import").length, 2);
		assert.equal(findings.filter((finding) => finding.rule === "missing-module-dependency").length, 5);
		assert.ok(findings.every((finding) => finding.file === "modules/invalid/mod.ts" && finding.line > 0));
	} finally {
		rmSync(path.join(root, "modules/invalid"), { recursive: true });
	}
});

test("tests may import public APIs without adding production dependencies, but cannot import internals", () => {
	const file = path.join(root, "modules/unrelated/logic.test.mts");
	writeFileSync(
		file,
		'import { value } from "../provider/mod.ts"; import type { X } from "../provider/src/private.ts";',
	);
	try {
		const findings = auditModuleImports(buildModuleGraph(root));
		assert.deepEqual(
			findings.map((finding) => finding.rule),
			["private-module-import"],
		);
	} finally {
		rmSync(file);
	}
});

test("audited stdlib recovery exception permits only deferred public stdlib imports and keeps their graph edge", () => {
	const policy = path.join(root, "stdlib-boundary-exceptions.json");
	writeFileSync(
		policy,
		JSON.stringify({
			schemaVersion: 1,
			exceptions: [
				{
					module: "recovery",
					file: "modules/recovery/metadata.json",
					rules: ["missing-stdlib-dependency"],
					reason: "Repairs stdlib when it cannot boot.",
				},
			],
		}),
	);
	fixture("recovery", 'const library = import("/modules/stdlib/mod.js");');
	try {
		assert.deepEqual(auditModuleImports(buildModuleGraph(root)), []);
		assert.ok(
			changedModuleSelection(buildModuleGraph(root), ["modules/stdlib/mod.ts"]).modules.includes("recovery"),
		);
		fixture(
			"recovery",
			'import "/modules/stdlib/mod.js"; const other = import("/modules/provider/mod.js"); const privateEntry = import("/modules/stdlib/src/private.ts");',
		);
		assert.deepEqual(
			auditModuleImports(buildModuleGraph(root)).map((finding) => finding.rule),
			["missing-module-dependency", "missing-module-dependency", "private-module-import"],
		);
	} finally {
		rmSync(policy);
		rmSync(path.join(root, "modules/recovery"), { recursive: true });
	}
});

test("selects transitive reverse dependents for source, type-only, metadata, and deleted-module changes", () => {
	const graph = buildModuleGraph(root);
	assert.deepEqual(changedModuleSelection(graph, ["modules/provider/deleted.ts"]).modules, [
		"consumer",
		"dependent",
		"provider",
	]);
	assert.deepEqual(changedModuleSelection(graph, ["modules/stdlib/mod.ts"]).modules, [
		"consumer",
		"dependent",
		"stdlib",
	]);
	fixture("orphan", "", { removed: "*" });
	fixture("relative-orphan", 'import "../removed/mod.js";');
	try {
		assert.deepEqual(changedModuleSelection(buildModuleGraph(root), ["modules/removed/metadata.json"]).modules, [
			"orphan",
			"relative-orphan",
		]);
	} finally {
		rmSync(path.join(root, "modules/orphan"), { recursive: true });
		rmSync(path.join(root, "modules/relative-orphan"), { recursive: true });
	}
});

test("shared tooling selects every module; docs-only and empty changes select none", () => {
	const graph = buildModuleGraph(root);
	for (const file of [
		"scripts/check-deps.ts",
		"packages/kit/src/build.ts",
		"tsconfig.module.json",
		"pnpm-lock.yaml",
		".github/workflows/check.yml",
		"remote-modules.d.ts",
	]) {
		const selection = changedModuleSelection(graph, [file]);
		assert.equal(selection.full, true, file);
		assert.equal(selection.modules.length, graph.modules.size);
	}
	assert.deepEqual(changedModuleSelection(graph, ["docs/guide.md", "README.md"]).modules, []);
	assert.deepEqual(changedModuleSelection(graph, []).modules, []);
});

test("reads committed, worktree, staged, renamed, deleted, and untracked paths against the merge base", () => {
	const commands: string[][] = [];
	const paths = gitChangedFiles(root, "origin/main", (args) => {
		commands.push(args);
		if (args[0] === "merge-base") return "abc123\n";
		if (args[0] === "ls-files") return "modules/new/untracked.ts\0";
		if (args.includes("abc123")) return "modules/old/mod.ts\0modules/new/mod.ts\0";
		return "modules/new/dirty.ts\0modules/old/mod.ts\0";
	});
	assert.deepEqual(paths, [
		"modules/new/dirty.ts",
		"modules/new/mod.ts",
		"modules/new/untracked.ts",
		"modules/old/mod.ts",
	]);
	assert.ok(commands.some((args) => args.includes("--no-renames")));
	assert.ok(commands.some((args) => args.includes("--cached")));
	assert.deepEqual(commands[0], ["merge-base", "origin/main", "HEAD"]);
});
