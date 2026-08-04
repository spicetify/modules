/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Closes the untested halves of the bump-to-release residuals (L4) and pins
// the pending quarantine (M4): a fixture repo exercises release.ts and
// release-notes.ts as real subprocesses, cwd'd into a throwaway git checkout.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { bumpVersion } from "./release.ts";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const RELEASE = path.join(SCRIPTS, "release.ts");
const NOTES = path.join(SCRIPTS, "release-notes.ts");

describe("bumpVersion", () => {
	it("bumps each level and preserves build metadata", () => {
		assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
		assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
		assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
		assert.equal(bumpVersion("1.2.3+xpui", "patch"), "1.2.4+xpui");
		assert.equal(bumpVersion("1.2", "patch"), "1.2.1");
	});
});

describe("fixture repo", () => {
	let repo: string;
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
	};
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
	const run = (script: string, ...args: string[]) => {
		const r = execFileSync("node", [script, ...args], { cwd: repo, env, encoding: "utf8" });
		return r;
	};
	const writeModule = (dir: string, meta: Record<string, unknown>) => {
		mkdirSync(path.join(repo, "modules", dir), { recursive: true });
		writeFileSync(path.join(repo, "modules", dir, "metadata.json"), JSON.stringify(meta, null, "\t"));
	};

	before(() => {
		repo = mkdtempSync(path.join(tmpdir(), "release-fixture-"));
		git("init", "-b", "main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "test");
		git("config", "commit.gpgsign", "false");
		git("config", "tag.gpgsign", "false");
		// zeta's DIRECTORY id differs from its metadata NAME; alpha depends
		// on the metadata name — the L4 dir-vs-name topo case.
		writeModule("zeta", { name: "zeta-name", version: "1.0.0" });
		writeModule("alpha", { name: "alpha", version: "1.0.0", dependencies: { "zeta-name": "^1.0.0" } });
		writeFileSync(path.join(repo, "vault.json"), JSON.stringify({ modules: {} }));
		git("add", "-A");
		git("commit", "-m", "feat: initial modules");
	});

	after(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	it("pending orders the dependency's directory before its dependent despite the name mismatch", () => {
		const pending = JSON.parse(run(RELEASE, "pending"));
		assert.deepEqual(pending, [
			{ id: "zeta", tag: "zeta-name@1.0.0" },
			{ id: "alpha", tag: "alpha@1.0.0" },
		]);
	});

	it("quarantines a tag that exists at another commit and keeps siblings pending", () => {
		git("tag", "-a", "alpha@1.0.0", "-m", "alpha@1.0.0");
		writeFileSync(path.join(repo, "modules", "alpha", "extra.ts"), "export const x = 1;\n");
		git("add", "-A");
		git("commit", "-m", "feat: move HEAD past the tag");

		// stdout keeps the JSON contract; the warning goes to stderr only.
		const r = execFileSync("node", [RELEASE, "pending"], { cwd: repo, env, encoding: "utf8" });
		assert.deepEqual(JSON.parse(r), [{ id: "zeta", tag: "zeta-name@1.0.0" }]);
		const withErr = spawnSync("node", [RELEASE, "pending"], { cwd: repo, env, encoding: "utf8" });
		assert.match(withErr.stderr, /quarantined alpha@1\.0\.0/);
		assert.ok(!withErr.stdout.includes("quarantined"));
		git("tag", "-d", "alpha@1.0.0");
		rmSync(path.join(repo, "modules", "alpha", "extra.ts"));
		git("add", "-A");
		git("commit", "-m", "chore: drop probe file");
	});

	it("a tag at HEAD itself is not quarantined (publish already started; action tolerates it)", () => {
		git("tag", "-a", "alpha@1.0.0", "-m", "alpha@1.0.0");
		const pending = JSON.parse(run(RELEASE, "pending"));
		assert.ok(pending.some((p: { tag: string }) => p.tag === "alpha@1.0.0"));
		git("tag", "-d", "alpha@1.0.0");
	});

	it("release notes exclude merge commit subjects but keep the merged branch's commits", () => {
		// previous release tag for the notes window
		git("tag", "-a", "zeta-name@0.9.0", "-m", "zeta-name@0.9.0");
		// branch with a real change, merged with a merge commit
		git("checkout", "-b", "feature");
		writeFileSync(path.join(repo, "modules", "zeta", "feature.ts"), "export const f = 1;\n");
		git("add", "-A");
		git("commit", "-m", "feat: branch change inside zeta");
		git("checkout", "main");
		git("merge", "--no-ff", "feature", "-m", "Merge pull request #1 from feature");
		// current tag + dist artifacts the notes script reads
		git("tag", "-a", "zeta-name@1.0.0", "-m", "zeta-name@1.0.0");
		mkdirSync(path.join(repo, "dist", "zeta-name@1.0.0"), { recursive: true });
		writeFileSync(
			path.join(repo, "dist", "zeta-name@1.0.0", "metadata.json"),
			JSON.stringify({ name: "zeta-name", version: "1.0.0", description: "fixture", authors: [] }),
		);
		writeFileSync(path.join(repo, "dist", "zeta-name@1.0.0.zip"), "not-a-real-zip");

		const notes = run(NOTES, "zeta-name@1.0.0");
		assert.match(notes, /branch change inside zeta/);
		assert.doesNotMatch(notes, /Merge pull request/);
	});
});
