/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The validator is the only thing standing between a vault diff and every
// user's client, so its refusals are pinned here: a rewritten published
// version, a version that moves backwards, an id changing hands, a lying
// card, a traversal entry, and a checksum that does not describe the bytes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
	compareVersions,
	inspectZip,
	metadataMismatches,
	ownerOf,
	unsafeZipEntries,
	validate,
} from "./validate-submission.ts";

describe("ownerOf", () => {
	it("collapses github URLs to the account", () => {
		assert.equal(ownerOf("https://github.com/someone/mod/releases/download/x/y.zip"), "github.com/someone");
		assert.equal(ownerOf("https://raw.githubusercontent.com/someone/mod/main/a.json"), "github.com/someone");
	});

	it("pins anything else to its host", () => {
		assert.equal(ownerOf("https://mods.example.com/a.zip"), "mods.example.com");
		assert.equal(ownerOf("not a url"), null);
	});
});

describe("compareVersions", () => {
	it("orders numerically, not lexically", () => {
		assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
		assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
		assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
	});
});

describe("metadataMismatches", () => {
	const artifact = { name: "mod", description: "d", preview: "https://e/p.png", authors: [{ name: "a" }] };

	it("passes an entry that matches the artifact", () => {
		assert.deepEqual(metadataMismatches({ ...artifact }, artifact), []);
	});

	it("allows curated github attribution on top of the artifact's authors", () => {
		const declared = { ...artifact, authors: [{ name: "a", github: "a" }] };
		assert.deepEqual(metadataMismatches(declared, artifact), []);
	});

	it("catches a card that describes something else", () => {
		const declared = { ...artifact, description: "totally different", authors: [{ name: "someone else" }] };
		const found = metadataMismatches(declared, artifact);
		assert.equal(found.length, 2);
		assert.match(found.join("\n"), /metadata\.description/);
		assert.match(found.join("\n"), /metadata\.authors/);
	});
});

describe("zip safety", () => {
	let dir: string;
	before(() => {
		dir = mkdtempSync(path.join(tmpdir(), "zip-safety-"));
	});
	after(() => rmSync(dir, { recursive: true, force: true }));

	it("accepts an ordinary build and rejects traversal and symlinks", () => {
		const staging = path.join(dir, "stage");
		mkdirSync(staging, { recursive: true });
		writeFileSync(path.join(staging, "metadata.json"), "{}");
		writeFileSync(path.join(staging, "index.js"), "export default () => {};");
		const clean = path.join(dir, "clean.zip");
		execFileSync("zip", ["-qr", clean, "."], { cwd: staging });
		assert.deepEqual(unsafeZipEntries(inspectZip(clean)), []);

		execFileSync("ln", ["-s", "/etc/passwd", path.join(staging, "leak")]);
		const evil = path.join(dir, "evil.zip");
		execFileSync("zip", ["-qry", evil, "."], { cwd: staging });
		const found = unsafeZipEntries(inspectZip(evil));
		assert.equal(found.length, 1);
		assert.match(found[0]!, /leak \(symlink\)/);
	});
});

describe("validate against a fixture repo", () => {
	let repo: string;
	let server: Server;
	let origin: string;
	let originalCwd: string;
	const artifacts = new Map<string, Buffer>();
	const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

	// In-process, not a subprocess: the fixture artifacts are served by this
	// same process, and execFileSync would block the event loop that has to
	// answer the validator's download.
	const report = async () => (await validate("base")).map((p) => `${p.id}: ${p.message}`).join("\n");

	const sha256 = (b: Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

	/** Builds a module zip the way spicetify-kit would and serves it. */
	const publishArtifact = (id: string, version: string, meta: Record<string, unknown> = {}) => {
		const staging = mkdtempSync(path.join(tmpdir(), "artifact-"));
		writeFileSync(
			path.join(staging, "metadata.json"),
			JSON.stringify({
				name: id,
				version,
				preview: `${origin}/preview.png`.replace("http://", "https://"),
				license: "MIT",
				repository: "https://github.com/author/mod",
				...meta,
			}),
		);
		writeFileSync(path.join(staging, "spicetify-module.json"), JSON.stringify({ installed_version: version }));
		writeFileSync(path.join(staging, "index.js"), "export default () => {};");
		const zip = path.join(staging, "out.zip");
		execFileSync("zip", ["-qr", zip, ".", "-x", "out.zip"], { cwd: staging });
		const bytes = readFileSync(zip);
		const key = `/${id}@${version}.zip`;
		artifacts.set(key, bytes);
		rmSync(staging, { recursive: true, force: true });
		return { url: `${origin}${key}`, checksum: sha256(bytes) };
	};

	const writeSource = (id: string, mod: unknown) => {
		mkdirSync(path.join(repo, "vault"), { recursive: true });
		writeFileSync(path.join(repo, "vault", `${id}.json`), `${JSON.stringify(mod, null, "\t")}\n`);
	};

	const entryFor = (id: string, version: string, meta: Record<string, unknown> = {}) => {
		const { url, checksum } = publishArtifact(id, version, meta);
		return { artifacts: [url], checksum, updatedAt: "2026-01-01" };
	};

	const cardFor = (over: Record<string, unknown> = {}) => ({
		name: "mod",
		preview: `${origin}/preview.png`.replace("http://", "https://"),
		license: "MIT",
		repository: "https://github.com/author/mod",
		...over,
	});

	before(async () => {
		server = createServer((req, res) => {
			const bytes = artifacts.get(req.url ?? "");
			if (!bytes) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(200, { "content-type": "application/zip" }).end(bytes);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

		repo = mkdtempSync(path.join(tmpdir(), "submission-fixture-"));
		git("init", "-b", "main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "test");
		git("config", "commit.gpgsign", "false");
		mkdirSync(path.join(repo, "vault"), { recursive: true });
		writeSource("mod", { metadata: cardFor(), v: { "1.0.0": entryFor("mod", "1.0.0") } });
		// Published from a real-shaped github URL, so the ownership rule has
		// something to hold later submissions to. Nothing fetches it: base
		// versions are never revalidated.
		writeSource("pinned", {
			metadata: cardFor({ repository: "https://github.com/author/pinned" }),
			v: {
				"1.0.0": {
					artifacts: ["https://github.com/author/pinned/releases/download/1.0.0/pinned@1.0.0.zip"],
					checksum: `sha256:${"a".repeat(64)}`,
				},
			},
		});
		git("add", "-A");
		git("commit", "-m", "base");
		git("branch", "base");
		// validate() resolves sources and runs git against the working
		// directory, so the fixture has to be it.
		originalCwd = process.cwd();
		process.chdir(repo);
	});

	after(async () => {
		process.chdir(originalCwd);
		rmSync(repo, { recursive: true, force: true });
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	const reset = () => {
		git("checkout", "-f", "main");
		git("reset", "--hard", "base");
	};

	// The fixture serves artifacts over http on a loopback port, so the
	// https rule and the host-matches-repository rule both fire by
	// construction. Both are asserted directly elsewhere; here they are
	// filtered so the remaining lines are the checks under test.
	const problems = (output: string) =>
		output
			.split("\n")
			.filter((line) => line.trim() && !/is not https/.test(line) && !/is hosted by/.test(line))
			.map((line) => line.trim());

	it("accepts a well-formed new version", async () => {
		reset();
		const before = JSON.parse(readFileSync(path.join(repo, "vault", "mod.json"), "utf8"));
		before.v["1.1.0"] = entryFor("mod", "1.1.0");
		writeSource("mod", before);
		git("add", "-A");
		git("commit", "-m", "publish 1.1.0");
		assert.deepEqual(problems(await report()), []);
	});

	it("refuses a rewritten published version", async () => {
		reset();
		const mod = JSON.parse(readFileSync(path.join(repo, "vault", "mod.json"), "utf8"));
		// The attack this blocks: the version key a user already verified
		// against, re-pointed at different bytes.
		mod.v["1.0.0"] = entryFor("mod", "1.0.1");
		writeSource("mod", mod);
		git("add", "-A");
		git("commit", "-m", "rewrite");
		assert.match(await report(), /1\.0\.0 was modified/);
	});

	it("refuses a version that is not newer", async () => {
		reset();
		const mod = JSON.parse(readFileSync(path.join(repo, "vault", "mod.json"), "utf8"));
		mod.v["0.9.0"] = entryFor("mod", "0.9.0");
		writeSource("mod", mod);
		git("add", "-A");
		git("commit", "-m", "backwards");
		assert.match(await report(), /not newer than the published 1\.0\.0/);
	});

	it("refuses an id changing hands", async () => {
		reset();
		// Neither URL is fetched: the ownership rule answers before anything
		// is downloaded, which is the point. A hijacked entry never gets to
		// serve bytes.
		const pinned = JSON.parse(readFileSync(path.join(repo, "vault", "pinned.json"), "utf8"));
		pinned.metadata = cardFor({ repository: "https://github.com/attacker/pinned" });
		pinned.v["2.0.0"] = {
			artifacts: ["https://github.com/attacker/pinned/releases/download/2.0.0/pinned@2.0.0.zip"],
			checksum: `sha256:${"b".repeat(64)}`,
		};
		writeSource("pinned", pinned);
		git("add", "-A");
		git("commit", "-m", "hijack");
		assert.match(
			await report(),
			/publishes from github\.com\/author, but this artifact comes from github\.com\/attacker/,
		);
	});

	it("refuses a checksum that does not describe the bytes", async () => {
		reset();
		const mod = JSON.parse(readFileSync(path.join(repo, "vault", "mod.json"), "utf8"));
		const entry = entryFor("mod", "1.2.0");
		entry.checksum = `sha256:${"0".repeat(64)}`;
		mod.v["1.2.0"] = entry;
		writeSource("mod", mod);
		git("add", "-A");
		git("commit", "-m", "bad checksum");
		assert.match(await report(), /checksum mismatch/);
	});

	it("refuses a card that does not match the artifact", async () => {
		reset();
		const mod = JSON.parse(readFileSync(path.join(repo, "vault", "mod.json"), "utf8"));
		mod.v["1.3.0"] = entryFor("mod", "1.3.0");
		mod.metadata = cardFor({ description: "something the code never claimed" });
		writeSource("mod", mod);
		git("add", "-A");
		git("commit", "-m", "lying card");
		assert.match(await report(), /metadata\.description/);
	});

	it("refuses an inline entry carrying executable content", async () => {
		reset();
		writeSource("snippet-evil", {
			metadata: { name: "evil", preview: "https://example.com/p.png" },
			v: { "1.0.0": { artifacts: [], files: { "index.js": "alert(1)" } } },
		});
		git("add", "-A");
		git("commit", "-m", "inline js");
		assert.match(await report(), /may only carry \.css files/);
	});

	it("refuses a removed version and a deleted module", async () => {
		reset();
		writeSource("mod", { metadata: cardFor(), v: {} });
		git("add", "-A");
		git("commit", "-m", "drop version");
		assert.match(await report(), /1\.0\.0 was removed/);

		reset();
		rmSync(path.join(repo, "vault", "mod.json"));
		git("add", "-A");
		git("commit", "-m", "delete module");
		assert.match(await report(), /removals need a maintainer's review/);
	});

	it("passes when nothing in the vault changed", async () => {
		reset();
		writeFileSync(path.join(repo, "unrelated.txt"), "hello");
		git("add", "-A");
		git("commit", "-m", "unrelated");
		assert.deepEqual(await report(), "");
	});
});
