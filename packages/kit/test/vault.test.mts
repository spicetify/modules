/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { runVault } from "../src/vault.ts";

const tmps: string[] = [];
function mk(): string {
	const d = mkdtempSync(path.join(tmpdir(), "kit-vault-"));
	tmps.push(d);
	return d;
}
after(() => {
	for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

function fixtureDist(root: string, meta: object): string {
	const d = path.join(root, "dist");
	mkdirSync(d, { recursive: true });
	writeFileSync(path.join(d, "metadata.json"), JSON.stringify(meta));
	return d;
}
const sha = (buf: Buffer) => `sha256:${createHash("sha256").update(buf).digest("hex")}`;

test("vault add: embeds the metadata subset and a sha256 of the zip; re-adds cleanly", async () => {
	const root = mk();
	const dist = fixtureDist(root, {
		name: "demo",
		version: "1.0.0",
		description: "D",
		authors: ["a"],
		tags: ["extension"],
	});
	const zipBytes = Buffer.from("ZIPDATA");
	const zip = path.join(root, "art.zip");
	writeFileSync(zip, zipBytes);
	const vaultPath = path.join(root, "vault.json");

	await runVault(
		["add", dist, "--artifact", "https://example.com/demo.zip", "--zip", zip, "--vault", vaultPath],
		root,
	);
	const mod = JSON.parse(readFileSync(vaultPath, "utf8"));
	const entry = mod.v["1.0.0"];
	assert.equal(entry.checksum, sha(zipBytes));
	// Card metadata lives at the module level, not per version; plain
	// author names normalize to objects so each can carry a github.
	assert.deepEqual(mod.metadata, { name: "demo", description: "D", authors: [{ name: "a" }], tags: ["extension"] });
	assert.equal(entry.metadata, undefined);
	assert.deepEqual(entry.artifacts, ["https://example.com/demo.zip"]);

	// Re-adding the same version with the same bytes overwrites cleanly.
	await runVault(
		["add", dist, "--artifact", "https://example.com/demo.zip", "--zip", zip, "--vault", vaultPath],
		root,
	);
	assert.equal(Object.keys(JSON.parse(readFileSync(vaultPath, "utf8")).v).length, 1);
});

test("vault add: a nonexistent --vault path is created with just the new entry", async () => {
	const root = mk();
	const dist = fixtureDist(root, { name: "demo", version: "1.0.0", description: "D", authors: ["a"], tags: [] });
	const zip = path.join(root, "art.zip");
	writeFileSync(zip, Buffer.from("X"));
	const vaultPath = path.join(root, "new-vault.json");
	assert.equal(existsSync(vaultPath), false);
	await runVault(["add", dist, "--artifact", "u", "--zip", zip, "--vault", vaultPath], root);
	assert.deepEqual(Object.keys(JSON.parse(readFileSync(vaultPath, "utf8")).v), ["1.0.0"]);
});

test("vault add: a checksum mismatch against an existing entry aborts without writing", async () => {
	const root = mk();
	const dist = fixtureDist(root, { name: "demo", version: "1.0.0", description: "D", authors: ["a"], tags: [] });
	const vaultPath = path.join(root, "vault.json");
	writeFileSync(vaultPath, JSON.stringify({ v: { "1.0.0": { artifacts: ["u"], checksum: "sha256:deadbeef" } } }));
	const before = readFileSync(vaultPath, "utf8");
	const zip = path.join(root, "art.zip");
	writeFileSync(zip, Buffer.from("NEW"));
	await assert.rejects(
		runVault(["add", dist, "--artifact", "u", "--zip", zip, "--vault", vaultPath], root),
		/checksum mismatch/,
	);
	assert.equal(readFileSync(vaultPath, "utf8"), before, "vault left unchanged");
});
