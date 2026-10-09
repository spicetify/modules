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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
	compareVersions,
	githubRepository,
	inspectZip,
	metadataMismatches,
	ownerOf,
	provenanceFrom,
	unsafeZipEntries,
	validate,
	validateSubmission,
	type ProvenanceVerifier,
} from "./validate-submission.ts";
import { metadataSubset } from "../packages/kit/src/vault-metadata.ts";
import { runVault } from "../packages/kit/src/vault.ts";

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

describe("githubRepository", () => {
	it("reads owner/repo from the forms a repository link takes", () => {
		assert.equal(githubRepository("https://github.com/someone/mod"), "someone/mod");
		assert.equal(githubRepository("https://github.com/someone/mod.git"), "someone/mod");
		assert.equal(githubRepository("https://github.com/someone/mod/tree/main/sub"), "someone/mod");
	});

	it("has nothing to say about other hosts", () => {
		assert.equal(githubRepository("https://codeberg.org/someone/mod"), null);
		assert.equal(githubRepository("https://github.com/someone"), null);
		assert.equal(githubRepository("not a url"), null);
	});
});

describe("provenanceFrom", () => {
	// A real `gh attestation verify --format json` result: the CLI's own
	// release binary, attested by the CLI's release workflow rather than by
	// the registry's builder.
	const cliRelease = JSON.parse(
		readFileSync(new URL("./fixtures/attestation-cli-release.json", import.meta.url), "utf8"),
	);
	const cliBinary = "sha256:3bab5f24e18244811189bd3b90bfb823c82fd2539b6b0755a12bac6802c8bc5b";
	const reason = (result: ReturnType<typeof provenanceFrom>) => ("unverified" in result ? result.unverified : "");

	it("refuses an attestation signed by a workflow other than the registry's builder", () => {
		assert.match(
			reason(provenanceFrom(cliRelease, cliBinary, "spicetify/cli")),
			/signed by https:\/\/github\.com\/spicetify\/cli\/\.github\/workflows\/rust-release\.yml/,
		);
	});

	// A real attestation from build-module itself, but signed by the workflow
	// as it stood on an unmerged pull request rather than a release.
	const unreleased = JSON.parse(
		readFileSync(new URL("./fixtures/attestation-build-module-pr.json", import.meta.url), "utf8"),
	);
	const fixtureZip = "sha256:545ecd7c800fcbca7d89ad7ca1246e90ee86812faaf9adc82c5ddd8a220d43db";

	// The same fixture module built by build-module on main.
	const released = JSON.parse(
		readFileSync(new URL("./fixtures/attestation-build-module-main.json", import.meta.url), "utf8"),
	);
	const releasedZip = "sha256:6889aebe4ba68878bc029484448cb826a8e931ea158c71cc3bdeb2bc4068aa21";

	it("accepts the builder at main and reports the commit the zip was built from", () => {
		const result = provenanceFrom(released, releasedZip, "spicetify/actions");
		assert.ok("provenance" in result, reason(result));
		assert.equal(result.provenance.commit, "91b890c761e773236bed6cb3ab78da223b83e523");
		assert.equal(result.provenance.ref, "refs/heads/main");
		assert.match(result.provenance.run, /\/actions\/runs\/37997562109\//);
	});

	it("refuses the builder at a ref that is neither a release nor main", () => {
		assert.match(reason(provenanceFrom(unreleased, fixtureZip, "spicetify/actions")), /refs\/pull\/4\/merge/);
	});

	it("refuses an attestation that covers other bytes", () => {
		assert.match(reason(provenanceFrom(cliRelease, `sha256:${"0".repeat(64)}`, "spicetify/cli")), /covers/);
	});

	it("refuses an attestation built from another repository", () => {
		assert.match(
			reason(provenanceFrom(cliRelease, cliBinary, "author/mod")),
			/built from https:\/\/github\.com\/spicetify\/cli/,
		);
	});

	it("treats an unreadable result as unverified", () => {
		for (const value of [null, "text", [], [{}], [{ verificationResult: {} }]]) {
			assert.notEqual(reason(provenanceFrom(value, cliBinary, "spicetify/cli")), "");
		}
	});
});

describe("compareVersions", () => {
	it("orders numerically, not lexically", () => {
		assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
		assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
		assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
	});

	it("ranks a release above its own prereleases", () => {
		// Getting this backwards leaves an author who shipped a beta unable
		// to publish the release: every candidate reads as "not newer".
		assert.ok(compareVersions("1.2.0", "1.2.0-beta.1") > 0);
		assert.ok(compareVersions("1.2.0-beta.1", "1.2.0") < 0);
		assert.ok(compareVersions("1.2.0-beta.2", "1.2.0-beta.1") > 0);
		assert.ok(compareVersions("1.2.0-beta.10", "1.2.0-beta.2") > 0, "numeric identifiers compare numerically");
		assert.ok(compareVersions("1.2.0-alpha", "1.2.0-beta") < 0);
		assert.ok(compareVersions("1.2.0-beta", "1.2.0-beta.1") < 0, "fewer identifiers rank lower");
	});

	it("keeps build metadata out of precedence but orders it deterministically", () => {
		// Not part of semver precedence, so it never outranks a real
		// difference; it still has to break ties, because the store picks a
		// version by sorting keys and taking the last one.
		assert.ok(compareVersions("1.2.1+cm-a", "1.2.0+cm-z") > 0, "the core still decides");
		assert.equal(compareVersions("1.2.0+cm-a", "1.2.0+cm-a"), 0);
		const forward = compareVersions("1.2.0+cm-a", "1.2.0+cm-b");
		assert.ok(forward !== 0, "a tie would make the store's pick vary run to run");
		assert.equal(Math.sign(forward), -Math.sign(compareVersions("1.2.0+cm-b", "1.2.0+cm-a")));
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
	const noAttestation: ProvenanceVerifier = () => ({ unverified: "not looked up in this fixture" });
	const report = async () => (await validate("base", noAttestation)).map((p) => `${p.id}: ${p.message}`).join("\n");

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

	it("re-checks the card when a metadata-only change lands", async () => {
		reset();
		const mod = JSON.parse(readFileSync(path.join(repo, "vault", "mod.json"), "utf8"));
		// No new version, so the old validator passed this with no checks at
		// all and the card could claim anything about published code.
		mod.metadata = cardFor({ description: "a description the code never declared" });
		writeSource("mod", mod);
		git("add", "-A");
		git("commit", "-m", "relabel");
		assert.match(await report(), /metadata\.description/);
	});

	it("refuses a pin at a version that does not exist", async () => {
		reset();
		const mod = JSON.parse(readFileSync(path.join(repo, "vault", "mod.json"), "utf8"));
		mod.enabled = "9.9.9";
		writeSource("mod", mod);
		git("add", "-A");
		git("commit", "-m", "bad pin");
		assert.match(await report(), /enabled pins 9\.9\.9/);
	});

	it("checks each new artifact's provenance against the repository it names", async () => {
		reset();
		const mod = JSON.parse(readFileSync(path.join(repo, "vault", "mod.json"), "utf8"));
		const entry = entryFor("mod", "1.4.0");
		mod.v["1.4.0"] = entry;
		writeSource("mod", mod);
		git("add", "-A");
		git("commit", "-m", "publish 1.4.0");
		const calls: Array<{ zip: boolean; repository: string; digest: string }> = [];
		const { provenance } = await validateSubmission("base", (zip, repository, digest) => {
			calls.push({ zip: existsSync(zip), repository, digest });
			return { unverified: "no attestation in this fixture" };
		});
		assert.deepEqual(calls, [{ zip: true, repository: "author/mod", digest: entry.checksum }]);
		assert.deepEqual(
			provenance.map((p) => `${p.id}@${p.version}`),
			["mod@1.4.0"],
		);
	});

	it("does not look up provenance for a repository outside GitHub", async () => {
		reset();
		const elsewhere = { repository: "https://codeberg.org/author/mod" };
		const mod = JSON.parse(readFileSync(path.join(repo, "vault", "mod.json"), "utf8"));
		mod.v["1.5.0"] = entryFor("mod", "1.5.0", elsewhere);
		mod.metadata = cardFor(elsewhere);
		writeSource("mod", mod);
		git("add", "-A");
		git("commit", "-m", "publish 1.5.0");
		let looked = false;
		const { provenance } = await validateSubmission("base", () => {
			looked = true;
			return { unverified: "unreachable" };
		});
		assert.equal(looked, false);
		const [only] = provenance;
		assert.ok(only && "unverified" in only.result);
		assert.match(only.result.unverified, /not a GitHub repository/);
	});

	it("passes when nothing in the vault changed", async () => {
		reset();
		writeFileSync(path.join(repo, "unrelated.txt"), "hello");
		git("add", "-A");
		git("commit", "-m", "unrelated");
		assert.deepEqual(await report(), "");
	});
});

describe("kit vault add submissions", () => {
	const root = mkdtempSync(path.join(tmpdir(), "kit-submission-"));
	after(() => rmSync(root, { recursive: true, force: true }));

	for (const declared of [{ kind: "extension" }, { tags: ["theme"] }]) {
		it(`writes a card the validator accepts for ${JSON.stringify(declared)}`, async () => {
			const meta = {
				name: "demo",
				version: "1.0.0",
				description: "D",
				authors: ["a"],
				license: "MIT",
				...declared,
			};
			const dist = path.join(root, `dist-${Object.keys(declared)[0]}`);
			mkdirSync(dist, { recursive: true });
			writeFileSync(path.join(dist, "metadata.json"), JSON.stringify(meta));
			const zip = path.join(dist, "art.zip");
			writeFileSync(zip, "X");
			const vaultPath = path.join(dist, "vault.json");
			await runVault(
				["add", dist, "--artifact", "https://example.com/demo.zip", "--zip", zip, "--vault", vaultPath],
				root,
			);
			const entry = JSON.parse(readFileSync(vaultPath, "utf8"));
			assert.deepEqual(metadataMismatches(entry.metadata, metadataSubset(meta) as Record<string, unknown>), []);
		});
	}
});
