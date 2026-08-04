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

const SCRIPT = path.resolve(import.meta.dirname, "release-notes.ts");

function sh(cwd: string, cmd: string, ...args: string[]): void {
	execFileSync(cmd, args, { cwd, stdio: "ignore" });
}

const roots: string[] = [];
after(() => {
	for (const r of roots) rmSync(r, { recursive: true, force: true });
});

// Fixture: a git repo with a module source dir, release tags, and the
// dist/ layout release-notes.ts reads (metadata + zip bytes).
function fixture(name: string, version: string, initialVersion = version) {
	const dir = mkdtempSync(path.join(tmpdir(), "notes-test-"));
	roots.push(dir);
	sh(dir, "git", "init", "-q");
	sh(dir, "git", "config", "user.email", "t@t");
	sh(dir, "git", "config", "user.name", "t");
	const modDir = path.join(dir, "modules", name);
	mkdirSync(modDir, { recursive: true });
	const writeMeta = (v: string) =>
		writeFileSync(
			path.join(modDir, "metadata.json"),
			JSON.stringify({ name, version: v, description: "Test module", authors: ["tester"] }, null, "\t"),
		);
	writeMeta(initialVersion);
	writeFileSync(path.join(modDir, "index.css"), "/* base */\n");
	sh(dir, "git", "add", "-A");
	sh(dir, "git", "commit", "-qm", `feat(${name}): add module`);

	const tag = `${name}@${version}`;
	const distDir = path.join(dir, "dist", tag);
	mkdirSync(distDir, { recursive: true });
	writeFileSync(
		path.join(distDir, "metadata.json"),
		JSON.stringify({ name, version, description: "Test module", authors: ["tester"] }),
	);
	writeFileSync(path.join(dir, "dist", `${tag}.zip`), "zip-bytes");

	return {
		dir,
		modDir,
		commitChange(file: string, subject: string) {
			writeFileSync(path.join(modDir, file), `/* ${subject} */\n`);
			sh(dir, "git", "add", "-A");
			sh(dir, "git", "commit", "-qm", subject);
		},
		bumpOnlyCommit(v: string, subject: string) {
			writeMeta(v);
			sh(dir, "git", "add", "-A");
			sh(dir, "git", "commit", "-qm", subject);
		},
		tagRelease(v: string) {
			sh(dir, "git", "tag", "-a", `${name}@${v}`, "-m", `${name}@${v}`);
		},
		notes(): string {
			const res = spawnSync(process.execPath, [SCRIPT, tag], { cwd: dir, encoding: "utf8" });
			assert.equal(res.status, 0, res.stderr);
			return res.stdout;
		},
	};
}

describe("release-notes.ts", () => {
	it("lists subjects since the previous release and excludes pre-window and bump-only commits", () => {
		const f = fixture("mod", "0.2.0", "0.1.0");
		f.commitChange("old.css", "fix(mod): pre-release change");
		f.tagRelease("0.1.0");
		f.commitChange("a.css", "fix(mod): windowed fix");
		f.commitChange("b.css", "feat(mod): windowed feature");
		f.bumpOnlyCommit("0.2.0", "chore(mod): bump to 0.2.0");
		f.tagRelease("0.2.0");
		const out = f.notes();
		assert.match(out, /\*\*What changed\*\*/);
		assert.match(out, /- feat\(mod\): windowed feature/);
		assert.match(out, /- fix\(mod\): windowed fix/);
		assert.doesNotMatch(out, /pre-release change/);
		assert.doesNotMatch(out, /chore\(mod\): bump to 0\.2\.0/);
		assert.match(out, /spicetify pkg install mod/);
	});

	it("keeps metadata-only commits that do not change the version", () => {
		const f = fixture("mod", "0.2.0", "0.1.0");
		f.tagRelease("0.1.0");
		writeFileSync(
			path.join(f.modDir, "metadata.json"),
			JSON.stringify(
				{ name: "mod", version: "0.1.0", description: "Better description", authors: ["tester"] },
				null,
				"\t",
			),
		);
		sh(f.dir, "git", "add", "-A");
		sh(f.dir, "git", "commit", "-qm", "docs(mod): sharpen the description");
		f.bumpOnlyCommit("0.2.0", "chore(mod): bump to 0.2.0");
		f.tagRelease("0.2.0");
		const out = f.notes();
		assert.match(out, /- docs\(mod\): sharpen the description/);
		assert.doesNotMatch(out, /chore\(mod\): bump to 0\.2\.0/);
	});

	it("includes a bump commit that also changes code", () => {
		const f = fixture("mod", "0.2.0", "0.1.0");
		f.tagRelease("0.1.0");
		// One commit changing both metadata and code: not bump-only.
		writeFileSync(
			path.join(f.modDir, "metadata.json"),
			JSON.stringify(
				{ name: "mod", version: "0.2.0", description: "Test module", authors: ["tester"] },
				null,
				"\t",
			),
		);
		f.commitChange("c.css", "feat(mod): change riding with the bump");
		f.tagRelease("0.2.0");
		assert.match(f.notes(), /- feat\(mod\): change riding with the bump/);
	});

	it("renders the first release without a history window", () => {
		const f = fixture("mod", "0.1.0");
		f.tagRelease("0.1.0");
		const out = f.notes();
		assert.match(out, /Initial release\./);
	});
});
