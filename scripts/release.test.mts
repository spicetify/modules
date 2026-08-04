/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const SCRIPT = path.resolve(import.meta.dirname, "release.ts");

type RunResult = { stdout: string; stderr: string; code: number };

function run(cwd: string, ...args: string[]): RunResult {
	const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
	return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? 1 };
}

function sh(cwd: string, cmd: string, ...args: string[]): string {
	return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const roots: string[] = [];
after(() => {
	for (const r of roots) rmSync(r, { recursive: true, force: true });
});

// A fixture repo shaped like the modules repo: content roots, vault.json,
// per-module release tags. Tests drive release.ts as a subprocess against
// it, exactly as CI does.
function fixture(): {
	dir: string;
	addModule: (id: string, version: string, opts?: { name?: string; deps?: Record<string, string> }) => void;
	setVersion: (id: string, version: string) => void;
	publish: (name: string, version: string) => void;
	touch: (id: string, file: string, subject: string) => void;
	commit: (subject: string) => void;
} {
	const dir = mkdtempSync(path.join(tmpdir(), "release-test-"));
	roots.push(dir);
	sh(dir, "git", "init", "-q");
	sh(dir, "git", "config", "user.email", "t@t");
	sh(dir, "git", "config", "user.name", "t");
	writeFileSync(path.join(dir, "vault.json"), JSON.stringify({ modules: {} }, null, "\t"));
	sh(dir, "git", "add", "-A");
	sh(dir, "git", "commit", "-qm", "init");

	const metaPath = (id: string) => path.join(dir, "modules", id, "metadata.json");
	const readMeta = (id: string) => JSON.parse(execFileSync("cat", [metaPath(id)], { encoding: "utf8" }));

	return {
		dir,
		addModule(id, version, opts = {}) {
			mkdirSync(path.join(dir, "modules", id), { recursive: true });
			writeFileSync(
				metaPath(id),
				JSON.stringify({ name: opts.name ?? id, version, dependencies: opts.deps ?? {} }, null, "\t"),
			);
			writeFileSync(path.join(dir, "modules", id, "index.css"), `/* ${id} */\n`);
			sh(dir, "git", "add", "-A");
			sh(dir, "git", "commit", "-qm", `feat(${id}): add module`);
		},
		setVersion(id, version) {
			const meta = readMeta(id);
			meta.version = version;
			writeFileSync(metaPath(id), JSON.stringify(meta, null, "\t"));
			sh(dir, "git", "add", "-A");
			sh(dir, "git", "commit", "-qm", `chore(${id}): bump to ${version}`);
		},
		publish(name, version) {
			const vaultPath = path.join(dir, "vault.json");
			const vault = JSON.parse(execFileSync("cat", [vaultPath], { encoding: "utf8" }));
			vault.modules[name] ??= { v: {} };
			vault.modules[name].v[version] = { artifacts: [], checksum: "sha256:test" };
			writeFileSync(vaultPath, JSON.stringify(vault, null, "\t"));
			sh(dir, "git", "add", "-A");
			sh(dir, "git", "commit", "-qm", `Publish ${name}@${version}`);
			sh(dir, "git", "tag", "-a", `${name}@${version}`, "-m", `${name}@${version}`);
		},
		touch(id, file, subject) {
			writeFileSync(path.join(dir, "modules", id, file), `/* ${subject} */\n`);
			sh(dir, "git", "add", "-A");
			sh(dir, "git", "commit", "-qm", subject);
		},
		commit(subject) {
			sh(dir, "git", "commit", "-qm", subject, "--allow-empty");
		},
	};
}

describe("release.ts pending", () => {
	it("lists bumped-unpublished modules dependency-first", () => {
		const f = fixture();
		f.addModule("lib", "1.0.0");
		f.addModule("app", "1.0.0", { deps: { lib: "^1.0.0" } });
		const out = JSON.parse(run(f.dir, "pending").stdout);
		assert.deepEqual(out, [
			{ id: "lib", tag: "lib@1.0.0" },
			{ id: "app", tag: "app@1.0.0" },
		]);
	});

	it("emits the literal empty array release.yml compares against", () => {
		const f = fixture();
		f.addModule("mod", "0.1.0");
		f.publish("mod", "0.1.0");
		assert.equal(run(f.dir, "pending").stdout.trim(), "[]");
	});

	it("keeps a tagged-but-unpublished version pending (failed publish retry)", () => {
		const f = fixture();
		f.addModule("mod", "0.1.0");
		// Tag exists (a publish started) but the vault never got the entry.
		sh(f.dir, "git", "tag", "-a", "mod@0.1.0", "-m", "mod@0.1.0");
		const out = JSON.parse(run(f.dir, "pending").stdout);
		assert.deepEqual(out, [{ id: "mod", tag: "mod@0.1.0" }]);
	});

	it("excludes published versions and resolves metadata name over directory name", () => {
		const f = fixture();
		f.addModule("dir-name", "0.1.0", { name: "real-name" });
		f.addModule("other", "0.1.0");
		f.publish("real-name", "0.1.0");
		const out = JSON.parse(run(f.dir, "pending").stdout);
		assert.deepEqual(out, [{ id: "other", tag: "other@0.1.0" }]);
	});
});

describe("release.ts status", () => {
	it("fails hard when a published version has unreleased changes, and soft-exits 0 with --soft", () => {
		const f = fixture();
		f.addModule("mod", "0.1.0");
		f.publish("mod", "0.1.0");
		f.touch("mod", "extra.css", "fix(mod): tweak something");
		const hard = run(f.dir, "status");
		assert.equal(hard.code, 1);
		assert.match(hard.stderr, /mod: changed since mod@0\.1\.0 but 0\.1\.0 is already published/);
		const soft = run(f.dir, "status", "--soft");
		assert.equal(soft.code, 0);
		assert.match(soft.stderr, /already published/);
	});

	it("passes when published modules are unchanged and bumps are pending", () => {
		const f = fixture();
		f.addModule("done", "0.1.0");
		f.publish("done", "0.1.0");
		f.addModule("fresh", "0.1.0");
		const res = run(f.dir, "status");
		assert.equal(res.code, 0);
		assert.match(res.stdout, /ok: every changed module/);
	});
});

describe("release.ts status --summary", () => {
	it("lists needs-bump modules with their commit subjects and awaiting-release modules", () => {
		const f = fixture();
		f.addModule("mod", "0.1.0");
		f.publish("mod", "0.1.0");
		f.touch("mod", "a.css", "fix(mod): first tweak");
		f.touch("mod", "b.css", "feat(mod): second change");
		f.addModule("newbie", "0.1.0");
		const res = run(f.dir, "status", "--summary", "--soft");
		assert.equal(res.code, 0);
		assert.match(res.stdout, /## Unreleased work/);
		assert.match(res.stdout, /\*\*mod\*\* — 0\.1\.0 is published but has unreleased changes/);
		assert.match(res.stdout, /fix\(mod\): first tweak/);
		assert.match(res.stdout, /feat\(mod\): second change/);
		assert.match(res.stdout, /\*\*newbie\*\* — 0\.1\.0 bumped, awaiting the release workflow/);
		// Hard summary exits 1 on the needs-bump violation.
		assert.equal(run(f.dir, "status", "--summary").code, 1);
	});

	it("reports a clean tree as fully released", () => {
		const f = fixture();
		f.addModule("mod", "0.1.0");
		f.publish("mod", "0.1.0");
		const res = run(f.dir, "status", "--summary", "--soft");
		assert.match(res.stdout, /All module changes are released\./);
	});
});
