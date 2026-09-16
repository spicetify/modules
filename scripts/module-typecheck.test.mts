import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { strictModules, typecheckModules } from "./module-typecheck.ts";

const repository = fileURLToPath(new URL("..", import.meta.url));

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), "module-typecheck-test-"));
	const module = path.join(root, "modules/pilot");
	mkdirSync(module, { recursive: true });
	symlinkSync(path.join(repository, "node_modules"), path.join(root, "node_modules"), "junction");
	for (const config of ["tsconfig.module.json", "tsconfig.module-strict.json"]) {
		copyFileSync(path.join(repository, config), path.join(root, config));
	}
	writeFileSync(
		path.join(root, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				jsx: "react-jsx",
				allowImportingTsExtensions: true,
				noEmit: true,
				strict: false,
				skipLibCheck: true,
				lib: ["ES2024", "DOM", "DOM.Iterable"],
				paths: { "/modules/*": ["./modules/*"] },
			},
		}),
	);
	writeFileSync(path.join(module, "metadata.json"), JSON.stringify({ name: "pilot" }));
	const write = (file: string, source: string) => {
		const target = path.join(root, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, source);
	};
	return {
		root,
		module,
		write,
		strict() {
			write(
				"modules/pilot/tsconfig.strict.json",
				JSON.stringify({ extends: "../../tsconfig.module-strict.json" }),
			);
		},
		check() {
			return typecheckModules({ root, modules: [module] });
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}

test("checks a complete strict module, including unimported TSX and implicit parameters", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	f.strict();
	f.write("modules/pilot/index.ts", "export const ready = true;");
	f.write(
		"modules/pilot/unimported.tsx",
		"export const element = <span>Ready</span>; export function identity(value) { return value; }",
	);
	assert.deepEqual(strictModules(f.root), [f.module]);
	const result = await f.check();
	assert.equal(result.ok, false);
	assert.match(result.output, /unimported\.tsx.*TS7006/);
	f.write(
		"modules/pilot/unimported.tsx",
		"export const element = <span>Ready</span>; export function identity(value: string) { return value; }",
	);
	assert.equal((await f.check()).ok, true);
});

test("keeps inferred dependency nullability while deferring only its strict diagnostics", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	f.strict();
	f.write(
		"modules/legacy/mod.ts",
		"export function lookup() { return Math.random() > 0.5 ? 'ready' : undefined; } export function identity(value) { return value; }",
	);
	f.write(
		"modules/pilot/index.ts",
		"import { lookup } from '/modules/legacy/mod.ts'; export const value: string = lookup();",
	);
	const failed = await f.check();
	assert.equal(failed.ok, false);
	assert.match(failed.output, /TS2322/);
	assert.match(failed.output, /strict dependency diagnostics deferred/);
	f.write(
		"modules/pilot/index.ts",
		"import { lookup } from '/modules/legacy/mod.ts'; export const value: string = lookup() ?? 'missing';",
	);
	const passed = await f.check();
	assert.equal(passed.ok, true);
	assert.match(passed.output, /1 strict dependency diagnostics deferred/);
});

test("fails ordinary dependency errors before strict diagnostic scoping", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	f.strict();
	f.write("modules/legacy/mod.ts", "export const value: number = 'wrong';");
	f.write("modules/pilot/index.ts", "export { value } from '/modules/legacy/mod.ts';");
	const result = await f.check();
	assert.equal(result.ok, false);
	assert.match(result.output, /client, baseline\): failed/);
	assert.match(result.output, /legacy[/\\]mod\.ts.*TS2322/);
	assert.doesNotMatch(result.output, /deferred/);
});

test("checks non-strict modules without migrating unrelated modules", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	f.write("modules/pilot/index.ts", "export const value: number = 'wrong';");
	f.write("modules/unrelated/index.ts", "this is not valid TypeScript");
	assert.deepEqual(strictModules(f.root), []);
	assert.equal((await f.check()).ok, false);
	f.write("modules/pilot/index.ts", "export function identity(value) { return value; }");
	const result = await f.check();
	assert.equal(result.ok, true);
	assert.doesNotMatch(result.output, /strict\)/);
});

test("checks Node tests separately from browser sources", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	f.strict();
	f.write("modules/pilot/index.ts", "export const title: string = document.title;");
	f.write(
		"modules/pilot/logic.test.mts",
		"import assert from 'node:assert/strict'; import { test } from 'node:test'; test('node', () => { assert.equal(typeof process.version, 'string'); });",
	);
	const passed = await f.check();
	assert.equal(passed.ok, true);
	assert.match(passed.output, /tests, strict\): passed/);
	f.write("modules/pilot/index.ts", "export const version = process.version;");
	const browserError = await f.check();
	assert.equal(browserError.ok, false);
	assert.match(browserError.output, /Cannot find name 'process'/);
	f.write("modules/pilot/index.ts", "export const title: string = document.title;");
	f.write("modules/pilot/logic.test.mts", "export const value: string = undefined;");
	const testError = await f.check();
	assert.equal(testError.ok, false);
	assert.match(testError.output, /tests, strict\): failed/);
});

test("compiler configuration failures cannot be deferred as dependency debt", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	f.strict();
	f.write("modules/pilot/index.ts", "export const ready = true;");
	f.write("modules/pilot/tsconfig.strict.json", JSON.stringify({ extends: "../../missing.json" }));
	const result = await f.check();
	assert.equal(result.ok, false);
	assert.match(result.output, /missing\.json/);
});

test("module configuration cannot weaken the strict gate", async (t) => {
	const f = fixture();
	t.after(f.cleanup);
	f.write(
		"modules/pilot/index.ts",
		"export function identity(value) { return value; } export const name: string = undefined;",
	);
	for (const compilerOptions of [{ noCheck: true }, { noImplicitAny: false }, { strictNullChecks: false }]) {
		f.write(
			"modules/pilot/tsconfig.strict.json",
			JSON.stringify({
				extends: "../../tsconfig.module-strict.json",
				compilerOptions,
			}),
		);
		const result = await f.check();
		assert.equal(result.ok, false, JSON.stringify(compilerOptions));
		assert.match(result.output, /TS7006/);
		assert.match(result.output, /TS2322/);
	}
});

test("the first strict pilot checks its real entry, settings UI, logic, and tests", async () => {
	assert.ok(strictModules(repository).includes(path.join(repository, "modules/auto-skip-explicit")));
	const result = await typecheckModules({ root: repository, modules: ["modules/auto-skip-explicit"] });
	assert.equal(result.ok, true, result.output);
	assert.match(result.output, /client, strict\): passed/);
	assert.match(result.output, /tests, strict\): passed/);
});
