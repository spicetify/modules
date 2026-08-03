#!/usr/bin/env node
/**
 * release - per-module versioning for the vault publish flow.
 *
 * Releases are per-module tags (`<name>@<version>`): the tag names the
 * exact unit being published, so tag uniqueness IS the vault's
 * never-overwrite rule. The vault keeps every released version; a
 * module whose code changed since its last release must carry a NEW
 * metadata.json version. Bump levels come from the conventional commits
 * that touched the module (feat -> minor, ! or BREAKING -> major, else
 * patch).
 *
 * usage:
 *   node scripts/release.ts status              # gate for PR CI
 *   node scripts/release.ts bump <id> [major|minor|patch]
 *   node scripts/release.ts tag [--push]        # tag every unpublished version
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

function suggestLevel(id: string, since: string | null): Level {
	if (!since) return "patch";
	const subjects = git(["log", `${since}..HEAD`, "--format=%s", "--", `modules/${id}`])
		.split("\n")
		.filter(Boolean);
	if (subjects.some((s) => /^[a-z]+(\([^)]*\))?!:/.test(s) || /BREAKING[ -]CHANGE/.test(s))) return "major";
	if (subjects.some((s) => /^feat(\([^)]*\))?:/.test(s))) return "minor";
	return "patch";
}

// The module's newest release tag reachable from HEAD (excluding tags
// on HEAD itself: in CI, HEAD is the freshly pushed tag). v:refname,
// not refname: plain lexicographic puts 0.10 before 0.9.
function lastModuleTag(id: string): string | null {
	const headTags = new Set(git(["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean));
	const tags = git(["tag", "--list", `${id}@*`, "--sort=-v:refname", "--merged", "HEAD"])
		.split("\n")
		.filter((t) => t && !headTags.has(t));
	return tags[0] ?? null;
}

function readMetadata(id: string): { name?: string; version?: string; dependencies?: Record<string, string> } {
	return JSON.parse(readFileSync(path.join("modules", id, "metadata.json"), "utf8"));
}

function moduleIds(): string[] {
	return readdirSync("modules", { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(path.join("modules", d.name, "metadata.json")))
		.map((d) => d.name)
		.sort();
}

function loadVault(): { modules?: Record<string, { v?: Record<string, unknown> }> } {
	return JSON.parse(readFileSync("vault.json", "utf8"));
}

function status(): void {
	// The vault is ground truth for what is published; the module's own
	// release tags provide the diff baseline. Both per-module: no batch
	// window, no cross-module noise.
	const vault = loadVault();
	const problems: string[] = [];
	for (const id of moduleIds()) {
		const now = readMetadata(id);
		if (!now.version) {
			problems.push(`${id}: metadata.json has no version`);
			continue;
		}
		const vaultId = now.name ?? id;
		const published = !!vault.modules?.[vaultId]?.v?.[now.version];
		if (!published) continue; // new version: publishable, nothing to check
		// The current version is already in the vault; any source change
		// since ITS release tag must come with a bump, or the change can
		// never ship (the publish flow refuses to overwrite).
		const releasedTag = `${vaultId}@${now.version}`;
		const baseline = git(["tag", "--list", releasedTag]) ? releasedTag : lastModuleTag(vaultId);
		if (!baseline) continue; // published outside tags (legacy/inline); no diff possible
		if (git(["diff", "--name-only", `${baseline}..HEAD`, "--", `modules/${id}`])) {
			const level = suggestLevel(id, baseline);
			problems.push(
				`${id}: changed since ${baseline} but ${now.version} is already published (suggest ${level} -> ${bumpVersion(now.version, level)})`,
			);
		}
	}
	if (problems.length) {
		console.error("modules not safe to publish:");
		for (const p of problems) console.error(`  ${p}`);
		process.exit(1);
	}
	console.log("ok: every changed module carries a new, unpublished version");
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

// Dependency-first order over module DIRECTORY ids (dependency maps
// key by metadata name, which may differ), so a batch of pushed tags
// publishes stdlib before its dependents and the vault never lists a
// dependent whose dependency is absent.
function topoOrder(dirIds: string[]): string[] {
	const dirByName = new Map(dirIds.map((dir) => [readMetadata(dir).name ?? dir, dir]));
	const seen = new Set<string>();
	const out: string[] = [];
	const visit = (dir: string) => {
		if (seen.has(dir)) return;
		seen.add(dir);
		const deps = readMetadata(dir).dependencies ?? {};
		for (const dep of Object.keys(deps)) {
			const depDir = dirByName.get(dep);
			if (depDir) visit(depDir);
		}
		out.push(dir);
	};
	for (const dir of dirIds) visit(dir);
	return out;
}

function tag(push: boolean): void {
	const vault = loadVault();
	const pending = new Map<string, string>(); // dir id -> tag
	for (const id of moduleIds()) {
		const meta = readMetadata(id);
		if (!meta.version) throw new Error(`${id}: metadata.json has no version`);
		const vaultId = meta.name ?? id;
		if (vault.modules?.[vaultId]?.v?.[meta.version]) continue; // published
		const t = `${vaultId}@${meta.version}`;
		if (git(["tag", "--list", t])) {
			// An existing tag means a publish already started; retry it by
			// re-running its workflow, never by re-tagging.
			console.log(`skip ${t}: tag exists (re-run its publish workflow to retry)`);
			continue;
		}
		pending.set(id, t);
	}
	const ordered = topoOrder([...pending.keys()]).map((dir) => pending.get(dir)!);
	if (!ordered.length) {
		console.log("nothing to tag: every module version is published");
		return;
	}
	for (const t of ordered) {
		if (push) {
			git(["tag", "-a", t, "-m", t]);
			git(["push", "origin", t]);
			console.log(`pushed ${t}`);
			// The publish concurrency group holds only ONE pending run:
			// pushing the next tag while one is queued CANCELS the queued
			// run (learned the hard way at launch). Wait for this tag's
			// run to finish before pushing the next; abort the batch on
			// failure so dependents never publish over a broken dependency.
			awaitPublish(t);
		} else {
			console.log(`would tag ${t}`);
		}
	}
	if (!push) console.log(`\ndry run: ${ordered.length} tag(s); re-run with --push to publish`);
}

function awaitPublish(tag: string): void {
	const deadline = Date.now() + 15 * 60 * 1000;
	process.stdout.write(`  waiting for publish run`);
	while (Date.now() < deadline) {
		let runs: Array<{ status: string; conclusion: string | null }> = [];
		try {
			runs = JSON.parse(
				execFileSync(
					"gh",
					[
						"run",
						"list",
						"--workflow",
						"publish.yml",
						"--branch",
						tag,
						"--limit",
						"1",
						"--json",
						"status,conclusion",
					],
					{ encoding: "utf8" },
				),
			);
		} catch {
			throw new Error("gh CLI unavailable: tags must be pushed one at a time, waiting for each publish run");
		}
		if (runs[0]?.status === "completed") {
			const conclusion = runs[0].conclusion ?? "unknown";
			console.log(` ${conclusion}`);
			if (conclusion !== "success") {
				throw new Error(
					`${tag}: publish run ${conclusion}; fix and re-run it, then re-run tag --push for the rest`,
				);
			}
			return;
		}
		process.stdout.write(".");
		execFileSync("sleep", ["10"]);
	}
	throw new Error(`${tag}: publish run did not finish within 15m`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "status") {
	status();
} else if (cmd === "bump") {
	const [id, level = "patch"] = rest;
	if (!id || !LEVELS.includes(level as Level)) throw new Error("usage: release.ts bump <id> [major|minor|patch]");
	bump(id, level as Level);
} else if (cmd === "tag") {
	tag(rest.includes("--push"));
} else {
	throw new Error("usage: release.ts status | bump <id> [major|minor|patch] | tag [--push]");
}
