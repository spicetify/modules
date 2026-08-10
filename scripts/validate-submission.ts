#!/usr/bin/env node
/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * validate-submission - the receiving end of a vault submission.
 *
 * The registry indexes bytes it never wrote: an entry is a URL plus a
 * checksum, and the store installs whatever that pair resolves to. So the
 * checksum is the contract, and everything here recomputes it from the
 * artifact rather than believing the submission. Nothing in the vault diff
 * is trusted as an assertion; it is only a claim to be checked.
 *
 * usage:
 *   node scripts/validate-submission.ts [--base <ref>]
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { downloadCapped } from "./download.ts";
import { SOURCE_DIR, sourceIds, sourcePath, type VaultModule, type VaultVersionEntry } from "./vault-build.ts";
import { metadataSubset } from "./vault.ts";

// An artifact is a module, not a payload: the largest thing in the vault
// today is under 2 MB, and the cap exists so a submission cannot make the
// store download something absurd before anyone notices.
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_INLINE_BYTES = 256 * 1024;
// Mirrors live in this repo's releases, so they are legitimately outside
// the author's own origin.
const MIRROR_ORIGIN = "github.com/spicetify";

export type Problem = { id: string; message: string };

// stderr is piped rather than inherited: `git show` on a path that does not
// exist in the base ref is an ordinary answer here, not something to print.
const git = (args: string[]) =>
	execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });

const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * Semver precedence, enough of it for what the vault carries.
 *
 * The numeric core decides first; a release outranks its own prereleases
 * (1.2.0 > 1.2.0-beta.1), which a plain string compare gets backwards and
 * which would otherwise leave an author who shipped a beta unable to publish
 * the release. Build metadata (+cm-<classmap>) is not part of precedence.
 */
export function compareVersions(a: string, b: string): number {
	const split = (v: string) => {
		const [core, ...rest] = v.split("+")[0]!.split("-");
		return { core: core!, pre: rest.join("-") };
	};
	const [va, vb] = [split(a), split(b)];
	const nums = (core: string) => core.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const [na, nb] = [nums(va.core), nums(vb.core)];
	for (let i = 0; i < Math.max(na.length, nb.length); i++) {
		const d = (na[i] ?? 0) - (nb[i] ?? 0);
		if (d) return d;
	}
	if (!va.pre && !vb.pre) return buildTiebreak(a, b);
	// A missing prerelease is the release, which always wins.
	if (!va.pre) return 1;
	if (!vb.pre) return -1;
	const [pa, pb] = [va.pre.split("."), vb.pre.split(".")];
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i];
		const y = pb[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const [nx, ny] = [Number.parseInt(x, 10), Number.parseInt(y, 10)];
		const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
		if (numeric) {
			if (nx !== ny) return nx - ny;
			continue;
		}
		// Numeric identifiers rank below alphanumeric ones.
		if (/^\d+$/.test(x)) return -1;
		if (/^\d+$/.test(y)) return 1;
		if (x !== y) return x < y ? -1 : 1;
	}
	return buildTiebreak(a, b);
}

/**
 * Build metadata (`+cm-<classmap>`) is not part of semver precedence, so two
 * keys that differ only there are equal by the spec. They still have to order
 * deterministically: the store picks a version by sorting keys and taking the
 * last, and an arbitrary tie would make that pick vary run to run.
 */
function buildTiebreak(a: string, b: string): number {
	const meta = (v: string) => v.split("+")[1] ?? "";
	const [ma, mb] = [meta(a), meta(b)];
	if (ma === mb) return 0;
	return ma < mb ? -1 : 1;
}

/**
 * Who is allowed to publish this id. GitHub URLs collapse to the owner, so
 * a module can move between an author's repositories but not between
 * accounts; anything else is pinned to its origin.
 */
export function ownerOf(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (parsed.hostname === "github.com" || parsed.hostname === "raw.githubusercontent.com") {
			const owner = parsed.pathname.split("/").filter(Boolean)[0];
			return owner ? `github.com/${owner}` : null;
		}
		return parsed.host;
	} catch {
		return null;
	}
}

/** The ids whose source file this change touches. */
export function changedIds(base: string): string[] {
	const out = git(["diff", "--name-only", `${base}...HEAD`, "--", SOURCE_DIR])
		.split("\n")
		.filter((f) => f.endsWith(".json"))
		.map((f) => path.basename(f, ".json"));
	return [...new Set(out)].sort();
}

function moduleAt(ref: string, id: string): VaultModule | null {
	try {
		return JSON.parse(git(["show", `${ref}:${SOURCE_DIR}/${id}.json`]));
	} catch {
		return null;
	}
}

const download = (url: string): Promise<Buffer> => downloadCapped(url, MAX_ARTIFACT_BYTES);

type ZipInspection = { names: string[]; symlinks: string[] };

/**
 * A zip entry becomes a path on disk (the CLI unpacks into the config
 * folder) and a key the loader executes from, so traversal and symlink
 * entries are rejected before anything is read out of the archive.
 */
export function inspectZip(zipPath: string): ZipInspection {
	const listing = execFileSync("unzip", ["-Z", "-1", zipPath], { encoding: "utf8", maxBuffer: 1 << 26 });
	const names = listing.split("\n").filter(Boolean);
	const long = execFileSync("unzip", ["-Z", zipPath], { encoding: "utf8", maxBuffer: 1 << 26 });
	// Long-listing lines end with the entry name after the timestamp, and a
	// name may contain spaces, so anchor on the time rather than splitting.
	const symlinks = long
		.split("\n")
		.map((line) => /^l\S*\s.*\d{2}:\d{2}\s+(.+)$/.exec(line)?.[1])
		.filter((name): name is string => !!name);
	return { names, symlinks };
}

export function unsafeZipEntries({ names, symlinks }: ZipInspection): string[] {
	const bad = names.filter(
		(name) =>
			name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || /^[a-zA-Z]:/.test(name),
	);
	return [...bad, ...symlinks.map((s) => `${s} (symlink)`)];
}

const readFromZip = (zipPath: string, member: string): string =>
	execFileSync("unzip", ["-p", zipPath, member], { maxBuffer: 1 << 26 }).toString();

/**
 * The card the store renders must describe the code that installs. Every
 * field the artifact declares has to appear verbatim in the entry; curated
 * additions (per-author github, which the artifact rarely carries) are the
 * only permitted divergence.
 */
export function metadataMismatches(
	declared: Record<string, unknown> | undefined,
	fromArtifact: Record<string, unknown>,
): string[] {
	const out: string[] = [];
	const vault = (declared ?? {}) as Record<string, unknown>;
	// The union of both sides, so an entry cannot invent a field the code
	// never declared (a description or a repository link of its own) any
	// more than it can contradict one.
	for (const key of new Set([...Object.keys(fromArtifact), ...Object.keys(vault)])) {
		// authors carry curated attribution and license has its own rule
		// (org publishes inherit this repo's); both are checked separately.
		if (key === "authors" || key === "license") continue;
		if (JSON.stringify(vault[key]) !== JSON.stringify(fromArtifact[key])) {
			out.push(
				`metadata.${key}: entry says ${JSON.stringify(vault[key])}, artifact says ${JSON.stringify(fromArtifact[key])}`,
			);
		}
	}
	const artifactAuthors = (fromArtifact.authors ?? []) as Array<{ name: string }>;
	const entryAuthors = (vault.authors ?? []) as Array<{ name: string }>;
	const names = (list: Array<{ name: string }>) => list.map((a) => a.name).join(", ");
	if (names(artifactAuthors) !== names(entryAuthors)) {
		out.push(`metadata.authors: entry says [${names(entryAuthors)}], artifact says [${names(artifactAuthors)}]`);
	}
	return out;
}

function validateInline(id: string, version: string, entry: VaultVersionEntry, problems: Problem[]): void {
	const push = (message: string) => problems.push({ id, message });
	if (entry.artifacts?.length) push(`${version}: an inline entry must not also declare artifacts`);
	const files = Object.entries(entry.files ?? {});
	if (!files.length) push(`${version}: inline entry has no files`);
	for (const [name, content] of files) {
		// Inline content installs without a checksum because the vault is
		// the artifact, so it is restricted to stylesheets: executable code
		// must arrive as a checksummed zip.
		if (!name.endsWith(".css")) push(`${version}: inline entries may only carry .css files, found ${name}`);
		if (Buffer.byteLength(content) > MAX_INLINE_BYTES) push(`${version}: ${name} is over the inline size cap`);
	}
}

async function validateArtifact(
	id: string,
	version: string,
	entry: VaultVersionEntry,
	head: VaultModule,
	knownIds: Set<string>,
	establishedOwner: string | null,
	problems: Problem[],
): Promise<void> {
	const push = (message: string) => problems.push({ id, message });
	const artifacts = entry.artifacts ?? [];
	if (!artifacts.length) return void push(`${version}: no artifact and no inline files`);
	for (const url of artifacts) {
		if (!url.startsWith("https://")) push(`${version}: artifact ${url} is not https`);
	}
	if (!entry.checksum)
		return void push(`${version}: no checksum; the checksum is what makes the artifact verifiable`);

	const primary = artifacts[0]!;
	const owner = ownerOf(primary);
	if (!owner) return void push(`${version}: cannot read an owner from ${primary}`);
	if (establishedOwner && owner !== establishedOwner && owner !== MIRROR_ORIGIN) {
		push(
			`${version}: ${id} publishes from ${establishedOwner}, but this artifact comes from ${owner}. ` +
				`An id stays with the account that first published it.`,
		);
	}

	let bytes: Buffer;
	try {
		bytes = await download(primary);
	} catch (e) {
		return void push(`${version}: ${(e as Error).message}`);
	}

	const actual = sha256(bytes);
	if (actual !== entry.checksum.toLowerCase()) {
		return void push(`${version}: checksum mismatch (entry ${entry.checksum}, artifact ${actual})`);
	}

	const dir = mkdtempSync(path.join(tmpdir(), "submission-"));
	const zipPath = path.join(dir, "artifact.zip");
	try {
		writeFileSync(zipPath, bytes);
		let inspection: ZipInspection;
		try {
			inspection = inspectZip(zipPath);
		} catch {
			return void push(`${version}: artifact is not a readable zip`);
		}
		const unsafe = unsafeZipEntries(inspection);
		if (unsafe.length) return void push(`${version}: unsafe zip entries: ${unsafe.join(", ")}`);
		if (!inspection.names.includes("metadata.json")) {
			return void push(`${version}: artifact has no metadata.json at its root`);
		}
		// The sidecar is written by the builder, so its absence means the
		// zip was assembled by hand rather than built by the toolchain.
		if (!inspection.names.includes("spicetify-module.json")) {
			push(`${version}: artifact has no spicetify-module.json; build it with spicetify-kit build`);
		}

		let meta: Record<string, unknown>;
		try {
			meta = JSON.parse(readFromZip(zipPath, "metadata.json"));
		} catch {
			return void push(`${version}: metadata.json in the artifact is not valid JSON`);
		}

		if (meta.name !== id)
			push(`${version}: artifact declares name ${JSON.stringify(meta.name)}, entry id is ${id}`);
		if (meta.version !== version) {
			push(`${version}: artifact declares version ${JSON.stringify(meta.version)}`);
		}
		const subset = metadataSubset(meta) as Record<string, unknown>;
		if (!entry.hidden) {
			if (!subset.preview) push(`${version}: metadata.preview (an absolute https URL) is required by the store`);
			if (!subset.repository) push(`${version}: metadata.repository (an https URL) is required`);
		}
		// The card has to say what a user is agreeing to install. An artifact
		// published by this org inherits the repository's own license, which
		// is why the entry may carry one the artifact does not declare; for
		// anyone else the artifact is the only authority for it.
		const orgPublished = owner === MIRROR_ORIGIN;
		const declaredLicense = typeof head.metadata?.license === "string" ? head.metadata.license : undefined;
		if (!entry.hidden && !declaredLicense) {
			push(`${version}: metadata.license (an SPDX identifier) is required`);
		} else if (subset.license && declaredLicense !== subset.license) {
			push(`${version}: entry declares license ${declaredLicense}, artifact declares ${subset.license}`);
		} else if (!subset.license && declaredLicense && !orgPublished) {
			push(`${version}: entry declares license ${declaredLicense}, but the artifact declares none`);
		}
		const repositoryOwner = typeof subset.repository === "string" ? ownerOf(subset.repository) : null;
		if (repositoryOwner && owner !== MIRROR_ORIGIN && repositoryOwner !== owner) {
			push(`${version}: artifact is hosted by ${owner} but metadata.repository points at ${repositoryOwner}`);
		}
		for (const dep of Object.keys((meta.dependencies ?? {}) as Record<string, unknown>)) {
			if (!knownIds.has(dep)) push(`${version}: depends on ${dep}, which is not in the vault`);
		}

		// Only the newest version drives the card, so that is the one the
		// entry's metadata has to agree with.
		const newest = Object.keys(head.v).sort(compareVersions).at(-1);
		if (newest === version) {
			for (const mismatch of metadataMismatches(head.metadata, subset)) push(`${version}: ${mismatch}`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export async function validate(base: string): Promise<Problem[]> {
	const problems: Problem[] = [];
	const ids = changedIds(base);
	if (!ids.length) {
		console.log("validate-submission: no vault sources changed");
		return problems;
	}
	const knownIds = new Set(sourceIds());

	for (const id of ids) {
		const push = (message: string) => problems.push({ id, message });
		if (!existsSync(sourcePath(id))) {
			// Removing a module is a curated act (revoke, or a takedown), so
			// it is flagged for a human rather than validated.
			push("source file was deleted; removals need a maintainer's review");
			continue;
		}
		if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
			push("id must be lowercase letters, digits and dashes");
		}

		let head: VaultModule;
		try {
			head = JSON.parse(readFileSync(sourcePath(id), "utf8"));
		} catch (e) {
			push(`unreadable source file: ${(e as Error).message}`);
			continue;
		}
		if (!head?.v || typeof head.v !== "object") {
			push('source file must be a module object with a "v" map');
			continue;
		}

		const before = moduleAt(base, id);
		// A published version is immutable: the checksum a user verified
		// against must keep describing the same bytes forever.
		for (const [version, entry] of Object.entries(before?.v ?? {})) {
			const now = head.v[version];
			if (!now) {
				push(`${version} was removed; published versions stay in the vault`);
				continue;
			}
			if (JSON.stringify(now) !== JSON.stringify(entry)) {
				push(`${version} was modified; publish a new version instead of rewriting a published one`);
			}
		}

		const added = Object.keys(head.v).filter((v) => !before?.v?.[v]);
		const highestBefore = Object.keys(before?.v ?? {})
			.sort(compareVersions)
			.at(-1);
		if (highestBefore) {
			for (const version of added) {
				if (compareVersions(version, highestBefore) <= 0) {
					push(`${version} is not newer than the published ${highestBefore}`);
				}
			}
		}

		// Established owner comes from what is already published, so the
		// first submission sets it and later ones are held to it.
		const establishedOwner = before
			? (Object.keys(before.v)
					.sort(compareVersions)
					.map((v) => before.v[v]?.artifacts?.[0])
					.filter((u): u is string => !!u)
					.map(ownerOf)
					.find((o) => o && o !== MIRROR_ORIGIN) ?? null)
			: null;

		for (const version of added) {
			const entry = head.v[version]!;
			if (entry.files) validateInline(id, version, entry, problems);
			else await validateArtifact(id, version, entry, head, knownIds, establishedOwner, problems);
		}

		// A change with no new version still changes what users see and what
		// they install. The card is re-checked against the artifact it claims
		// to describe, and a pin has to name a version that exists, so an
		// already-published module cannot be repointed or relabelled after
		// its review.
		if (!added.length && JSON.stringify(before) !== JSON.stringify(head)) {
			const newest = Object.keys(head.v).sort(compareVersions).at(-1);
			const entry = newest ? head.v[newest] : undefined;
			if (!newest || !entry) {
				push("has no versions");
			} else if (JSON.stringify(before?.metadata) !== JSON.stringify(head.metadata)) {
				if (entry.files) {
					console.log(`${id}: metadata-only change on an inline entry`);
				} else {
					await validateArtifact(id, newest, entry, head, knownIds, establishedOwner, problems);
				}
			}
			if (head.enabled !== before?.enabled) {
				if (head.enabled && !head.v[head.enabled]) {
					push(`enabled pins ${head.enabled}, which is not a version of this module`);
				} else if (head.enabled) {
					console.log(`${id}: pinned to ${head.enabled}; a downgrade pin needs a maintainer's review`);
				}
			}
		}
	}
	return problems;
}

async function main(): Promise<void> {
	const i = process.argv.indexOf("--base");
	const base = i >= 0 ? process.argv[i + 1]! : "origin/main";
	const problems = await validate(base);
	if (!problems.length) {
		console.log("validate-submission: ok");
		return;
	}
	for (const { id, message } of problems) console.error(`${id}: ${message}`);
	console.error(`\nvalidate-submission: ${problems.length} problem(s)`);
	process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
