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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

// The tag a publish run would compare against: the newest tag that is
// reachable from HEAD but not on it (in CI, HEAD is the freshly pushed
// release tag itself). --merged keeps side-branch and backdated tags
// from corrupting the baseline.
function previousTag(): string | null {
	const headTags = new Set(git(["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean));
	const tags = git(["tag", "--sort=-creatordate", "--merged", "HEAD"])
		.split("\n")
		.filter((t) => t && !headTags.has(t));
	return tags[0] ?? null;
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

function status(): void {
	const since = previousTag();
	// The vault is ground truth, not tags: a tag whose run failed must
	// not reset the baseline, and a reused or downgraded version must
	// never overwrite a published entry.
	const vault = JSON.parse(readFileSync("vault.json", "utf8"));
	if (!since) {
		console.log("no previous tag; every module publishes as new");
		return;
	}
	const changed = new Set(
		git(["diff", "--name-only", `${since}..HEAD`, "--", "modules/"])
			.split("\n")
			.map((f) => f.match(/^modules\/([^/]+)\//)?.[1])
			.filter((id): id is string => !!id && existsSync(path.join("modules", id, "metadata.json"))),
	);
	const problems: string[] = [];
	for (const id of [...changed].sort()) {
		const now = JSON.parse(readFileSync(path.join("modules", id, "metadata.json"), "utf8"));
		const level = suggestLevel(id, since);
		const hint = `suggest ${level} -> ${bumpVersion(now.version, level)}`;
		if (vault.modules?.[id]?.v?.[now.version]) {
			problems.push(`${id}: ${now.version} is already published in the vault (${hint})`);
			continue;
		}
		const then = metadataAt(since, id);
		if (then?.version !== undefined && then.version === now.version) {
			problems.push(`${id}: changed since ${since} but still ${now.version} (${hint})`);
		}
	}
	if (problems.length) {
		console.error(`modules not safe to publish (changed since ${since}):`);
		for (const p of problems) console.error(`  ${p}`);
		process.exit(1);
	}
	console.log(`ok: every module changed since ${since} carries a new, unpublished version`);
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
