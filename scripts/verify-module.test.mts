import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
	verificationTarget,
	moduleTests,
	verifyModule,
	verifyChanged,
	parseVerificationArgs,
} from "./verify-module.ts";

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "verify-module-")));
after(() => rmSync(root, { recursive: true, force: true }));
for (const dir of [
	"modules/example/nested",
	"themes/example",
	"outside",
	"modules/example/dist",
	"modules/example/node_modules",
]) {
	mkdirSync(path.join(root, dir), { recursive: true });
}
for (const dir of ["modules/example", "themes/example", "outside"]) {
	writeFileSync(path.join(root, dir, "metadata.json"), JSON.stringify({ name: "example" }));
}
for (const file of ["logic.test.mts", "nested/deep.test.mts", "dist/output.test.mts", "node_modules/vendor.test.mts"]) {
	writeFileSync(path.join(root, "modules/example", file), "");
}

test("resolves a module ID or an explicit theme path within the repository", () => {
	assert.equal(verificationTarget("example", root), path.join(root, "modules/example"));
	assert.equal(verificationTarget("themes/example", root), path.join(root, "themes/example"));
});

test("rejects missing and outside targets instead of silently verifying the whole repository", () => {
	assert.throws(() => verificationTarget("", root), /module/);
	assert.throws(() => verificationTarget("absent", root), /metadata/);
	assert.throws(() => verificationTarget("outside", root), /content root/);
});

test("discovers nested module tests without executing built files or dependencies", () => {
	assert.deepEqual(
		moduleTests(path.join(root, "modules/example")).map((file) => path.relative(root, file)),
		[path.join("modules", "example", "logic.test.mts"), path.join("modules", "example", "nested", "deep.test.mts")],
	);
});

test("stops on a failed check and never reports verification success", async () => {
	const steps: string[] = [];
	await assert.rejects(
		verifyModule("example", root, {
			build: async () => {
				steps.push("build");
			},
			types: async () => ({ ok: false, output: "invalid module type" }),
			boundary: () => {},
			run: () => {
				steps.push("run");
			},
			log: () => {},
		}),
		/invalid module type/,
	);
	assert.deepEqual(steps, ["build"]);
});

test("runs the discovered tests and preserves the repository dependency gate", async () => {
	const commands: string[][] = [];
	await verifyModule("example", root, {
		build: async () => {},
		types: async () => ({ ok: true, output: "" }),
		boundary: () => {},
		run: (args) => {
			commands.push(args);
		},
		log: () => {},
	});
	assert.ok(commands.some((args) => args.includes(path.join(root, "scripts/check-deps.ts"))));
	const tests = commands.find((args) => args[0] === "--test");
	assert.deepEqual(tests?.slice(1), moduleTests(path.join(root, "modules/example")));
});

test("reports no automated tests explicitly for a CSS-only target", async () => {
	const messages: string[] = [];
	const commands: string[][] = [];
	await verifyModule("themes/example", root, {
		build: async () => {},
		types: async () => ({ ok: true, output: "" }),
		boundary: () => {},
		run: (args) => {
			commands.push(args);
		},
		log: (message) => {
			messages.push(message);
		},
	});
	assert.ok(messages.some((message) => message.includes("No module tests")));
	assert.ok(!commands.some((args) => args[0] === "--test"));
});

test("accepts changed mode with an optional base and rejects ambiguous arguments", () => {
	assert.deepEqual(parseVerificationArgs(["--changed"]), { kind: "changed", base: "origin/main" });
	assert.deepEqual(parseVerificationArgs(["--changed", "--base", "HEAD~2"]), { kind: "changed", base: "HEAD~2" });
	assert.deepEqual(parseVerificationArgs(["example"]), { kind: "module", target: "example" });
	for (const args of [
		["--base", "main"],
		["--changed", "example"],
		["--changed", "--base"],
		["--changed", "--base", "--all"],
	]) {
		assert.throws(() => parseVerificationArgs(args), /Usage/);
	}
});

test("changed verification runs only affected modules and shared changes invoke the full gate", async () => {
	const changedRoot = mkdtempSync(path.join(tmpdir(), "verify-changed-"));
	for (const [id, dependencies] of [
		["library", {}],
		["consumer", { library: "*" }],
		["unrelated", {}],
	] as const) {
		const directory = path.join(changedRoot, "modules", id);
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			path.join(directory, "metadata.json"),
			JSON.stringify({ name: id, version: "1.0.0", dependencies }),
		);
	}
	const builds: string[] = [];
	const messages: string[] = [];
	let fullRuns = 0;
	let dependencyRuns = 0;
	const steps = {
		build: async (directory: string) => {
			builds.push(path.basename(directory));
		},
		types: async () => ({ ok: true, output: "" }),
		boundary: () => {},
		run: (args: string[]) => {
			if (args[0].endsWith("scripts/check-deps.ts")) dependencyRuns++;
		},
		log: (message: string) => {
			messages.push(message);
		},
		full: async () => {
			fullRuns++;
		},
	};
	try {
		await verifyChanged({ root: changedRoot, files: ["modules/library/deleted.ts"], steps });
		assert.deepEqual(builds, ["consumer", "library"]);
		assert.equal(dependencyRuns, 1);
		assert.equal(fullRuns, 0);
		builds.length = 0;
		await verifyChanged({ root: changedRoot, files: ["scripts/stitch.ts"], steps });
		assert.deepEqual(builds, ["consumer", "library", "unrelated"]);
		assert.equal(fullRuns, 1);
		builds.length = 0;
		await verifyChanged({ root: changedRoot, files: [], steps });
		assert.deepEqual(builds, []);
		assert.ok(messages.some((message) => message.includes("No affected modules")));
	} finally {
		rmSync(changedRoot, { recursive: true, force: true });
	}
});
