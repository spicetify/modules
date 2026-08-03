#!/usr/bin/env node
/**
 * release - per-module versioning for the vault publish flow.
 *
 * The vault keeps every released version, so a publish must never
 * overwrite a live one: a module whose code changed since the last
 * tag must carry a NEW metadata.json version. Releases stay batch
 * date tags (one atomic catalog update); this tool enforces the one
 * rule that makes them safe, and derives the bump level from the
 * conventional commits that touched each module (feat -> minor,
 * fix/refactor/etc -> patch, ! or BREAKING -> major).
 *
 * usage:
 *   node scripts/release.ts status                  # gate for publish.yml
 *   node scripts/release.ts bump <id> [major|minor|patch]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

const LEVELS = ["patch", "minor", "major"] as const;
type Level = (typeof LEVELS)[number];

function bumpVersion(version: string, level: Level): string {
	const [coreAndPre, build] = version.split("+");
	const [core] = coreAndPre.split("-");
	const parts = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
	while (parts.length < 3) parts.push(0);
	if (level === "major") {
		parts[0] += 1;
		parts[1] = 0;
		parts[2] = 0;
	} else if (level === "minor") {
		parts[1] += 1;
		parts[2] = 0;
	} else {
		parts[2] += 1;
	}
	return parts.join(".") + (build ? `+${build}` : "");
}

function suggestLevel(id: string, since: string): Level {
	const subjects = git(["log", `${since}..HEAD`, "--format=%s", "--", `modules/${id}`])
		.split("\n")
		.filter(Boolean);
	if (subjects.some((s) => /^[a-z]+(\([^)]*\))?!:/.test(s) || /BREAKING[ -]CHANGE/.test(s))) return "major";
	if (subjects.some((s) => /^feat(\([^)]*\))?:/.test(s))) return "minor";
	return "patch";
}

// The tag a publish run would compare against: the newest RELEASE tag
// (date pattern, same as the workflow trigger) that is reachable from
// HEAD but not on it (in CI, HEAD is the freshly pushed release tag
// itself). --merged keeps side-branch and backdated tags out.
//
// Tags are dates because the repo has no repo-level version to name:
// modules version independently in their own metadata.json, so the tag
// identifies the publishing event. The optional suffix is for a
// same-day re-release (2026-08-03, then 2026-08-03.1).
const RELEASE_TAG = "20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]*";
function previousTag(): string | null {
	const headTags = new Set(git(["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean));
	// v:refname, not refname: plain lexicographic puts .10 before .9.
	const tags = git(["tag", "--list", RELEASE_TAG, "--sort=-v:refname", "--merged", "HEAD"])
		.split("\n")
		.filter((t) => t && !headTags.has(t));
	// A tag whose run failed before publishing never landed a vault.json
	// change on our ancestry; it must not become the baseline or the diff
	// window shrinks past the very changes that failed the gate.
	for (const tag of tags) {
		if (git(["log", "--format=%H", "-1", `${tag}..HEAD`, "--", "vault.json"])) return tag;
	}
	return null;
}

function metadataAt(ref: string, id: string): { version?: string } | null {
	try {
		return JSON.parse(
			execFileSync("git", ["show", `${ref}:modules/${id}/metadata.json`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}),
		);
	} catch {
		return null; // module did not exist at that ref
	}
}

function readMetadata(id: string): { name?: string; version?: string } {
	return JSON.parse(readFileSync(path.join("modules", id, "metadata.json"), "utf8"));
}

function status(): void {
	const since = previousTag();
	// The vault is ground truth, not tags: a tag whose run failed must
	// not reset the baseline, and a reused or downgraded version must
	// never overwrite a published entry.
	const vault = JSON.parse(readFileSync("vault.json", "utf8"));
	const changed = new Set(
		since
			? git(["diff", "--name-only", `${since}..HEAD`, "--", "modules/"])
					.split("\n")
					.map((f) => f.match(/^modules\/([^/]+)\//)?.[1])
					.filter((id): id is string => !!id && existsSync(path.join("modules", id, "metadata.json")))
			: [],
	);
	// Without a previous tag there is no diff window; the vault reuse
	// check still applies to every module.
	const ids = since
		? [...changed].sort()
		: readdirSync("modules", { withFileTypes: true })
				.filter((d) => d.isDirectory() && existsSync(path.join("modules", d.name, "metadata.json")))
				.map((d) => d.name)
				.sort();
	const problems: string[] = [];
	for (const id of ids) {
		const now = readMetadata(id);
		if (!now.version) {
			problems.push(`${id}: metadata.json has no version`);
			continue;
		}
		const level = since ? suggestLevel(id, since) : "patch";
		const hint = `suggest ${level} -> ${bumpVersion(now.version, level)}`;
		// The vault keys modules by metadata name, not directory name.
		const vaultId = now.name ?? id;
		if (vault.modules?.[vaultId]?.v?.[now.version]) {
			problems.push(`${id}: ${now.version} is already published in the vault (${hint})`);
			continue;
		}
		const then = since ? metadataAt(since, id) : null;
		if (then?.version !== undefined && then.version === now.version) {
			problems.push(`${id}: changed since ${since} but still ${now.version} (${hint})`);
		}
	}
	if (problems.length) {
		console.error(since ? `modules not safe to publish (changed since ${since}):` : "modules not safe to publish:");
		for (const p of problems) console.error(`  ${p}`);
		process.exit(1);
	}
	console.log(
		since
			? `ok: every module changed since ${since} carries a new, unpublished version`
			: "ok: no previous tag and no version already published",
	);
}

function bump(id: string, level: Level): void {
	const metaPath = path.join("modules", id, "metadata.json");
	const meta = JSON.parse(readFileSync(metaPath, "utf8"));
	if (!meta.version) throw new Error(`${metaPath} has no version`);
	const next = bumpVersion(meta.version, level);
	meta.version = next;
	writeFileSync(metaPath, `${JSON.stringify(meta, null, "\t")}\n`);
	// Match the repo's JSON style when the formatter is available.
	try {
		execFileSync(path.join(process.cwd(), "node_modules", ".bin", "oxfmt"), [metaPath], { stdio: "ignore" });
	} catch {
		console.warn("warning: oxfmt unavailable; metadata.json left in JSON.stringify formatting");
	}
	console.log(`${id}: bumped to ${next}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "status") {
	status();
} else if (cmd === "bump") {
	const [id, level = "patch"] = rest;
	if (!id || !LEVELS.includes(level as Level)) throw new Error("usage: release.ts bump <id> [major|minor|patch]");
	bump(id, level as Level);
} else {
	throw new Error("usage: release.ts status | bump <id> [major|minor|patch]");
}
