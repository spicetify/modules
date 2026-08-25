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
 *   node scripts/release.ts status [--soft]     # gate (soft = warn only)
 *   node scripts/release.ts status --summary [--soft]  # job-summary markdown
 *   node scripts/release.ts pending             # topo-ordered unpublished, JSON
 *   node scripts/release.ts bump <id> [major|minor|patch]
 *   node scripts/release.ts autobump [--dry-run]  # bump + propagate ranges
 *   node scripts/release.ts tag [--push]        # tag every unpublished version
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

// Release tags are the diff baseline, so a checkout that has not fetched reads
// the wrong one and reports a changed module as untouched since its release.
// The bump is then skipped and the change never releases: `pending` returns
// nothing, the release run succeeds having published nothing, and no step
// reports a problem. This refreshes the remote-tracking branches too, which is
// what lets loadVault judge published state against the remote.
// A failure here (offline, no remote) must not block the run, so it degrades to
// the local tags. The warning goes to stderr because stdout is parsed — by
// `pending` for the release matrix, and by `--summary` for the step summary.
function syncTags(): void {
	try {
		execFileSync("git", ["fetch", "--tags", "--quiet", "origin"], {
			stdio: ["ignore", "ignore", "pipe"],
			timeout: 15_000,
		});
	} catch {
		console.warn("[release] could not fetch tags; judging against the local checkout, which may be stale");
	}
}

const LEVELS = ["patch", "minor", "major"] as const;
type Level = (typeof LEVELS)[number];

// A module opts a commit out of release calculation with this trailer. Later
// releasable commits must still trigger a bump, so evaluate every touching
// commit independently instead of letting one old trailer mask the whole
// range.
const SKIP_TRAILER = /^Release-As:\s*none$/im;

function releaseCommitSubjects(id: string, since: string): string[] {
	const hashes = git(["log", `${since}..HEAD`, "--format=%H", "--", moduleDir(id)])
		.split("\n")
		.filter(Boolean);
	return hashes.flatMap((hash) => {
		const body = git(["show", "-s", "--format=%B", hash]);
		if (SKIP_TRAILER.test(body)) return [];
		return [git(["show", "-s", "--format=%s", hash])];
	});
}

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
	const subjects = releaseCommitSubjects(id, since);
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

// Content roots, split by kind for repo navigation only; ids stay
// unique across all of them (the vault and runtime have one namespace).
const ROOTS = ["modules", "themes", "snippets"];

function moduleDir(id: string): string {
	const dirs = ROOTS.map((r) => path.join(r, id)).filter((d) => existsSync(path.join(d, "metadata.json")));
	if (dirs.length > 1) throw new Error(`${id} exists in multiple roots: ${dirs.join(", ")}`);
	if (!dirs.length) throw new Error(`no module directory for ${id} in ${ROOTS.join("/")}`);
	return dirs[0];
}

function readMetadata(id: string): { name?: string; version?: string; dependencies?: Record<string, string> } {
	return JSON.parse(readFileSync(path.join(moduleDir(id), "metadata.json"), "utf8"));
}

function moduleIds(): string[] {
	const ids = ROOTS.filter(existsSync).flatMap((root) =>
		readdirSync(root, { withFileTypes: true })
			.filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, "metadata.json")))
			.map((d) => d.name),
	);
	const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
	if (dupes.length) throw new Error(`module ids exist in multiple roots: ${[...new Set(dupes)].join(", ")}`);
	return ids.sort();
}

// The remote branch this checkout tracks, when it carries commits HEAD does
// not have. Strictly-behind is too narrow: local work on top of a stale base
// diverges rather than trails, and that is the shape the bug arrives in.
// Null when there is no upstream, when the ref cannot be read, or when HEAD
// already contains it — including every CI run, which checks out the pushed
// commit itself.
function staleUpstream(): { ref: string; missing: string } | null {
	try {
		const ref = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
		if (!ref) return null;
		const missing = git(["rev-list", "--count", `HEAD..${ref}`]);
		return missing === "0" ? null : { ref, missing };
	} catch {
		return null;
	}
}

// Published state comes from the vault, and syncTags cannot keep it honest:
// tags are fetched into the object store, the vault is a working-tree file
// written by origin's own publish commits. A checkout that predates them
// reads a vault with the newest releases missing and calls them unpublished —
// `status` answers ok, the bump is skipped, and the change ships onto a
// version that is already taken. Reading the vault from the remote ref keeps
// the answer right until the pull happens.
function loadVault(): { modules?: Record<string, { v?: Record<string, unknown> }> } {
	const stale = staleUpstream();
	if (stale) {
		console.warn(
			`[release] this checkout is missing ${stale.missing} commit(s) from ${stale.ref}; ` +
				`judging published state against ${stale.ref}:vault.json. Pull to silence this.`,
		);
		try {
			return JSON.parse(git(["show", `${stale.ref}:vault.json`]));
		} catch {
			console.warn(
				`[release] could not read ${stale.ref}:vault.json; falling back to the local checkout, which is stale`,
			);
		}
	}
	return JSON.parse(readFileSync("vault.json", "utf8"));
}

type ModuleState = {
	id: string;
	tag: string;
	version: string;
	// needs-bump: published version with unreleased source changes.
	// awaiting-release: bumped version not yet in the vault.
	kind: "needs-bump" | "awaiting-release";
	commits: string[];
	hint?: string;
};

// The vault is ground truth for what is published; the module's own
// release tags provide the diff baseline. Both per-module: no batch
// window, no cross-module noise.
function analyze(): { states: ModuleState[]; malformed: string[] } {
	const vault = loadVault();
	const states: ModuleState[] = [];
	const malformed: string[] = [];
	for (const id of moduleIds()) {
		const now = readMetadata(id);
		if (!now.version) {
			malformed.push(`${id}: metadata.json has no version`);
			continue;
		}
		const vaultId = now.name ?? id;
		const published = !!vault.modules?.[vaultId]?.v?.[now.version];
		const subjectsSince = (baseline: string) =>
			git(["log", `${baseline}..HEAD`, "--format=%s", "--", moduleDir(id)])
				.split("\n")
				.filter(Boolean);
		if (!published) {
			const baseline = lastModuleTag(vaultId);
			states.push({
				id,
				tag: `${vaultId}@${now.version}`,
				version: now.version,
				kind: "awaiting-release",
				commits: baseline ? subjectsSince(baseline) : [],
			});
			continue;
		}
		// The current version is already in the vault; any source change
		// since ITS release tag must come with a bump, or the change can
		// never ship (the publish flow refuses to overwrite).
		const releasedTag = `${vaultId}@${now.version}`;
		const baseline = git(["tag", "--list", releasedTag]) ? releasedTag : lastModuleTag(vaultId);
		if (!baseline) continue; // published outside tags (legacy/inline); no diff possible
		const commits = subjectsSince(baseline);
		if (git(["diff", "--name-only", `${baseline}..HEAD`, "--", moduleDir(id)])) {
			const level = suggestLevel(id, baseline);
			states.push({
				id,
				tag: releasedTag,
				version: now.version,
				kind: "needs-bump",
				commits,
				hint: `suggest ${level} -> ${bumpVersion(now.version, level)}`,
			});
		}
	}
	return { states, malformed };
}

function status(soft: boolean): void {
	const { states, malformed } = analyze();
	const problems = [
		...malformed,
		...states
			.filter((s) => s.kind === "needs-bump" && !stateSkipsRelease(s))
			.map((s) => `${s.id}: changed since ${s.tag} but ${s.version} is already published (${s.hint})`),
	];
	if (problems.length) {
		console.error("modules not safe to publish:");
		for (const p of problems) console.error(`  ${p}`);
		console.error(
			"the bump is manual and belongs in the same change: run `node scripts/release.ts autobump` " +
				"(or `bump <id> <level>`) and commit the metadata.json it writes",
		);
		process.exit(soft ? 0 : 1);
	}
	console.log("ok: every changed module carries a new, unpublished version");
}

// Markdown for $GITHUB_STEP_SUMMARY: the per-module unreleased state,
// computed fresh from git — the "which modules need a release" surface.
function summary(soft: boolean): void {
	const analyzed = analyze();
	const states = analyzed.states.filter((state) => !stateSkipsRelease(state));
	const { malformed } = analyzed;
	const lines: string[] = ["## Unreleased work", ""];
	if (!states.length && !malformed.length) {
		lines.push("All module changes are released.");
	}
	for (const s of states) {
		if (s.kind === "needs-bump") {
			lines.push(`- **${s.id}** — ${s.version} is published but has unreleased changes (${s.hint}):`);
		} else {
			lines.push(`- **${s.id}** — ${s.version} bumped, awaiting the release workflow:`);
		}
		for (const c of s.commits.slice(0, 15)) lines.push(`  - ${c}`);
		if (s.commits.length > 15) lines.push(`  - …and ${s.commits.length - 15} more`);
	}
	for (const m of malformed) lines.push(`- ⚠ ${m}`);
	console.log(lines.join("\n"));
	const violating = malformed.length > 0 || states.some((s) => s.kind === "needs-bump");
	if (violating && !soft) process.exit(1);
}

// Topo-ordered bumped-but-unpublished modules, for release.yml.
// A module whose tag already exists at another commit is QUARANTINED
// (warned and excluded) instead of entering the matrix: the release
// action would refuse it as a racing tag, and under fail-fast that
// single wedged module used to cancel every queued sibling. Recovery
// stays the documented human path (docs/pr-flow.md).
function pendingJson(): void {
	const pending = new Map<string, string>();
	for (const s of analyze().states.filter((s) => s.kind === "awaiting-release")) {
		if (git(["tag", "--list", s.tag])) {
			const tagSha = git(["rev-parse", `${s.tag}^{commit}`]);
			const headSha = git(["rev-parse", "HEAD"]);
			if (tagSha !== headSha) {
				console.error(
					`quarantined ${s.tag}: tag exists at ${tagSha.slice(0, 7)}, not HEAD ${headSha.slice(0, 7)} ` +
						"(racing or stale tag); siblings continue. Recovery: docs/pr-flow.md",
				);
				continue;
			}
		}
		pending.set(s.id, s.tag);
	}
	const ordered = topoOrder([...pending.keys()]).map((id) => ({ id, tag: pending.get(id)! }));
	console.log(JSON.stringify(ordered));
}

// Writes metadata.json in the repo's JSON style when the formatter is
// available. JSON.stringify expands every array onto its own lines, so an
// unformatted write shows up as a whole-file diff.
function writeMetadata(metaPath: string, meta: unknown): void {
	writeFileSync(metaPath, `${JSON.stringify(meta, null, "\t")}\n`);
	try {
		execFileSync(path.join(process.cwd(), "node_modules", ".bin", "oxfmt"), [metaPath], { stdio: "ignore" });
	} catch {
		console.warn("warning: oxfmt unavailable; metadata.json left in JSON.stringify formatting");
	}
}

function bump(id: string, level: Level): void {
	const metaPath = path.join(moduleDir(id), "metadata.json");
	const meta = JSON.parse(readFileSync(metaPath, "utf8"));
	if (!meta.version) throw new Error(`${metaPath} has no version`);
	const next = bumpVersion(meta.version, level);
	meta.version = next;
	writeMetadata(metaPath, meta);
	console.log(`${id}: bumped to ${next}`);
}

function skipsRelease(id: string, since: string | null): boolean {
	if (!since) return false;
	const touching = git(["log", `${since}..HEAD`, "--format=%H", "--", moduleDir(id)])
		.split("\n")
		.filter(Boolean);
	return touching.length > 0 && releaseCommitSubjects(id, since).length === 0;
}

function stateSkipsRelease(state: ModuleState): boolean {
	if (state.kind !== "needs-bump") return false;
	const baseline = git(["tag", "--list", state.tag]) ? state.tag : lastModuleTag(state.tag.split("@")[0]);
	return skipsRelease(state.id, baseline);
}

function rangeFor(version: string): string {
	return `^${version}`;
}

/**
 * Writes the bump each changed module already implies, then propagates it:
 * a dependent of a bumped module has its range moved to the new version and
 * is itself bumped, so it can never ship against an installed dependency
 * that predates the export it uses. Without that second half an automatic
 * bump makes the silent-undefined failure MORE likely, not less.
 *
 * Returns the modules it changed, dependency-first.
 */
function autobump(apply: boolean): string[] {
	const { states, malformed } = analyze();
	if (malformed.length) throw new Error(malformed.join("\n"));

	const bumped = new Map<string, string>(); // dir id -> new version
	const plan: Array<{ id: string; level: Level; reason: string }> = [];

	for (const state of states.filter((s) => s.kind === "needs-bump")) {
		if (stateSkipsRelease(state)) {
			console.log(`${state.id}: skipped (Release-As: none)`);
			continue;
		}
		const baseline = git(["tag", "--list", state.tag]) ? state.tag : lastModuleTag(state.tag.split("@")[0]);
		plan.push({ id: state.id, level: suggestLevel(state.id, baseline), reason: "own changes" });
	}

	// Propagate to a fixpoint: a dependent bumped in one pass can itself be
	// the dependency of another module.
	const dirIds = moduleIds();
	const dirByName = new Map(dirIds.map((dir) => [readMetadata(dir).name ?? dir, dir]));
	const planned = new Set(plan.map((p) => p.id));
	for (let pass = 0; pass < dirIds.length; pass++) {
		let added = false;
		for (const dir of dirIds) {
			if (planned.has(dir)) continue;
			const deps = readMetadata(dir).dependencies ?? {};
			// Only a minor or major moves a dependent. A caret range already
			// admits its dependency's patches, and a patch adds no export a
			// dependent could be reaching for, so cascading there would
			// republish the whole graph for nothing.
			const touched = Object.keys(deps).some((dep) => {
				const depDir = dirByName.get(dep);
				if (!depDir) return false;
				const depPlan = plan.find((p) => p.id === depDir);
				return depPlan ? depPlan.level !== "patch" : false;
			});
			if (touched) {
				plan.push({ id: dir, level: "patch", reason: "dependency bumped" });
				planned.add(dir);
				added = true;
			}
		}
		if (!added) break;
	}

	const ordered = topoOrder(plan.map((p) => p.id));
	for (const id of ordered) {
		const entry = plan.find((p) => p.id === id)!;
		const meta = readMetadata(id);
		const next = bumpVersion(meta.version!, entry.level);
		console.log(`${id}: ${meta.version} -> ${next} (${entry.level}, ${entry.reason})`);
		if (apply) {
			bump(id, entry.level);
			// Only a minor or major belongs here, for the same reason it is the
			// only thing that cascades: a caret range already admits its
			// dependency's patches, so rewriting on a patch churns every
			// dependent and leaves it "changed since its tag", which demands a
			// bump of the whole graph on the next run.
			if (entry.level !== "patch") bumped.set(readMetadata(id).name ?? id, next);
		}
	}

	// Move every declared range onto the versions just published, including
	// for modules that were not themselves bumped.
	if (apply) {
		for (const dir of dirIds) {
			const metaPath = path.join(moduleDir(dir), "metadata.json");
			const meta = JSON.parse(readFileSync(metaPath, "utf8"));
			let changed = false;
			for (const [dep, range] of Object.entries(meta.dependencies ?? {})) {
				const newVersion = bumped.get(dep);
				if (newVersion && range !== rangeFor(newVersion)) {
					meta.dependencies[dep] = rangeFor(newVersion);
					changed = true;
				}
			}
			if (changed) {
				writeMetadata(metaPath, meta);
				console.log(`${dir}: ranges -> ${JSON.stringify(meta.dependencies)}`);
			}
		}
	}

	return ordered;
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
			// A retagged tag (deleted after a failed run) still has old
			// runs on its ref; remember the newest so the wait below never
			// mistakes it for this push's run.
			const prevRun = latestRunId(t);
			git(["tag", "-a", t, "-m", t]);
			git(["push", "origin", t]);
			console.log(`pushed ${t}`);
			// The publish concurrency group holds only ONE pending run:
			// pushing the next tag while one is queued CANCELS the queued
			// run (learned the hard way at launch). Wait for this tag's
			// run to finish before pushing the next; abort the batch on
			// failure so dependents never publish over a broken dependency.
			awaitPublish(t, prevRun);
		} else {
			console.log(`would tag ${t}`);
		}
	}
	if (!push) console.log(`\ndry run: ${ordered.length} tag(s); re-run with --push to publish`);
}

type GhRun = { databaseId: number; status: string; conclusion: string | null };

function listRuns(tag: string): GhRun[] {
	try {
		return JSON.parse(
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
					"databaseId,status,conclusion",
				],
				{ encoding: "utf8" },
			),
		);
	} catch {
		throw new Error("gh CLI unavailable: tags must be pushed one at a time, waiting for each publish run");
	}
}

function latestRunId(tag: string): number | null {
	return listRuns(tag)[0]?.databaseId ?? null;
}

function awaitPublish(tag: string, prevRun: number | null): void {
	const deadline = Date.now() + 15 * 60 * 1000;
	process.stdout.write(`  waiting for publish run`);
	while (Date.now() < deadline) {
		const run = listRuns(tag)[0];
		// Ignore anything that predates this push: a retagged ref keeps
		// its old (failed) runs, and reading one as this push's verdict
		// aborted a batch at launch.
		if (run && run.databaseId !== prevRun && run.status === "completed") {
			const conclusion = run.conclusion ?? "unknown";
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

export { bumpVersion, suggestLevel, topoOrder };

// CLI dispatch only when invoked directly; importable under node --test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	dispatch();
}

function dispatch(): void {
	const [cmd, ...rest] = process.argv.slice(2);
	syncTags();
	if (cmd === "status") {
		if (rest.includes("--summary")) summary(rest.includes("--soft"));
		else status(rest.includes("--soft"));
	} else if (cmd === "pending") {
		pendingJson();
	} else if (cmd === "bump") {
		const [id, level = "patch"] = rest;
		if (!id || !LEVELS.includes(level as Level)) throw new Error("usage: release.ts bump <id> [major|minor|patch]");
		bump(id, level as Level);
	} else if (cmd === "autobump") {
		// --dry-run prints the plan without touching metadata, so the same
		// code path can gate a PR and perform the release.
		autobump(!rest.includes("--dry-run"));
	} else if (cmd === "tag") {
		tag(rest.includes("--push"));
	} else {
		throw new Error(
			"usage: release.ts status [--summary] [--soft] | pending | bump <id> [major|minor|patch] | autobump [--dry-run] | tag [--push]",
		);
	}
}
