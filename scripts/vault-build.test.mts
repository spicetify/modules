/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The vault is stored per module and served as one aggregate, so the build
// is the only thing keeping the two in agreement. These pin the parts that
// would silently corrupt the catalog: composition, determinism, the
// staleness gate, and vault.ts writing through to the sources.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { compose, sourceIds } from "./vault-build.ts";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(SCRIPTS, "vault-build.ts");
const VAULT = path.join(SCRIPTS, "vault.ts");
const REPO = path.dirname(SCRIPTS);

describe("vault-build", () => {
	let root: string;

	const write = (id: string, mod: unknown) =>
		writeFileSync(path.join(root, "vault", `${id}.json`), `${JSON.stringify(mod, null, "\t")}\n`);
	const run = (script: string, ...args: string[]) =>
		spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8" });

	before(() => {
		root = mkdtempSync(path.join(tmpdir(), "vault-build-"));
		mkdirSync(path.join(root, "vault"), { recursive: true });
		// oxfmt is resolved from the working root; without it serialize()
		// degrades to JSON.stringify, which is fine but would make the
		// fixture's formatting differ from the repo's.
		mkdirSync(path.join(root, "node_modules"), { recursive: true });
		execFileSync("ln", ["-s", path.join(REPO, "node_modules", ".bin"), path.join(root, "node_modules", ".bin")]);
		write("beta", { metadata: { name: "beta" }, v: { "1.0.0": { artifacts: ["https://example.com/b.zip"] } } });
		write("alpha", { metadata: { name: "alpha" }, v: { "1.0.0": { files: { "index.css": "body{}" } } } });
	});

	after(() => rmSync(root, { recursive: true, force: true }));

	it("composes every source file, id-sorted", () => {
		const vault = compose(root);
		assert.deepEqual(Object.keys(vault.modules), ["alpha", "beta"]);
		assert.equal(vault.modules.alpha?.v["1.0.0"]?.files?.["index.css"], "body{}");
		assert.equal(vault.revoked, undefined);
		assert.deepEqual(sourceIds(root), ["alpha", "beta"]);
	});

	it("merges revocations from revoked.json", () => {
		writeFileSync(path.join(root, "revoked.json"), JSON.stringify({ beta: "malware" }));
		assert.deepEqual(compose(root).revoked, { beta: "malware" });
		rmSync(path.join(root, "revoked.json"));
		assert.equal(compose(root).revoked, undefined);
	});

	it("rejects a source file that is not a module object", () => {
		write("broken", { metadata: { name: "broken" } });
		assert.throws(() => compose(root), /expected a module object/);
		rmSync(path.join(root, "vault", "broken.json"));
	});

	it("builds, is idempotent, and gates on staleness", () => {
		const first = run(BUILD);
		assert.equal(first.status, 0, first.stderr);
		const built = readFileSync(path.join(root, "vault.json"), "utf8");
		assert.deepEqual(Object.keys(JSON.parse(built).modules), ["alpha", "beta"]);

		const second = run(BUILD);
		assert.match(second.stdout, /already current/);
		assert.equal(readFileSync(path.join(root, "vault.json"), "utf8"), built);
		assert.equal(run(BUILD, "--check").status, 0);

		write("gamma", { metadata: { name: "gamma" }, v: { "1.0.0": { artifacts: ["https://example.com/g.zip"] } } });
		const stale = run(BUILD, "--check");
		assert.equal(stale.status, 1);
		assert.match(stale.stderr, /stale/);
		assert.equal(run(BUILD).status, 0);
		assert.equal(run(BUILD, "--check").status, 0);
	});

	it("vault.ts writes through to a single source file and rebuilds", () => {
		const dist = path.join(root, "dist", "delta@1.0.0");
		mkdirSync(dist, { recursive: true });
		writeFileSync(
			path.join(dist, "metadata.json"),
			JSON.stringify({ name: "delta", version: "1.0.0", preview: "https://example.com/p.png" }),
		);
		const zip = path.join(root, "delta.zip");
		writeFileSync(zip, "not really a zip, only its bytes are hashed");

		const added = run(VAULT, "add", "dist/delta@1.0.0", "--artifact", "https://example.com/d.zip", "--zip", zip);
		assert.equal(added.status, 0, added.stderr);

		const source = JSON.parse(readFileSync(path.join(root, "vault", "delta.json"), "utf8"));
		assert.match(source.v["1.0.0"].checksum, /^sha256:[0-9a-f]{64}$/);
		assert.equal(source.metadata.preview, "https://example.com/p.png");
		// The aggregate is rebuilt in the same act, so the two never drift.
		assert.equal(run(BUILD, "--check").status, 0);
		assert.ok(JSON.parse(readFileSync(path.join(root, "vault.json"), "utf8")).modules.delta);
		// Untouched modules keep their files byte for byte.
		assert.equal(
			JSON.parse(readFileSync(path.join(root, "vault", "alpha.json"), "utf8")).v["1.0.0"].files["index.css"],
			"body{}",
		);
	});
});
