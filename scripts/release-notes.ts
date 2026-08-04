#!/usr/bin/env node
/**
 * release-notes - compose the GitHub release body for a module tag.
 *
 * usage:
 *   node scripts/release-notes.ts <name>@<version>
 *
 * Reads the stitched artifact from dist/<name>@<version>{,.zip} and
 * prints markdown: what the module is, what changed since its previous
 * release, and the artifact checksum in sha256sum format for offline
 * verification.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const tag = process.argv[2];
if (!tag?.includes("@")) throw new Error("usage: release-notes.ts <name>@<version>");
const name = tag.slice(0, tag.lastIndexOf("@"));
const version = tag.slice(tag.lastIndexOf("@") + 1);

const meta = JSON.parse(readFileSync(path.join("dist", tag, "metadata.json"), "utf8"));
const zip = readFileSync(path.join("dist", `${tag}.zip`));
const sha = createHash("sha256").update(zip).digest("hex");

const authors: string[] = (meta.authors ?? []).map((a: string | { name: string }) =>
	typeof a === "string" ? a : a.name,
);

const git = (...args: string[]): string =>
	execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// The module's source dir, resolved by metadata name across the content
// roots (directory names may differ from metadata names).
function sourceDir(): string | null {
	for (const root of ["modules", "themes", "snippets"]) {
		if (!existsSync(root)) continue;
		for (const entry of readdirSync(root)) {
			const metaPath = path.join(root, entry, "metadata.json");
			try {
				if (JSON.parse(readFileSync(metaPath, "utf8")).name === name) return path.join(root, entry);
			} catch {
				// not a module dir
			}
		}
	}
	return null;
}

// Commit subjects since the previous release of this module, newest
// first, excluding commits that only touched metadata.json (the bump
// itself carries no user-facing change).
function changesSincePreviousRelease(): string[] | null {
	const dir = sourceDir();
	if (!dir) return null;
	let tags: string[];
	try {
		tags = git("tag", "--list", `${name}@*`, "--sort=-v:refname").split("\n").filter(Boolean);
	} catch {
		return null; // not a git checkout (e.g. packed source); skip the section
	}
	// Both publish paths create the tag before notes run, so the current
	// tag is in the list and the previous release is the next entry down.
	// The idx === -1 fallback (newest existing tag) only serves local
	// pre-tag runs and assumes the release being drafted is the newest
	// version — out-of-order backports would get a wrong window there.
	const idx = tags.indexOf(tag);
	const prev = idx >= 0 ? tags[idx + 1] : tags[0];
	if (!prev) return []; // first release
	const shas = git("log", "--format=%H", `${prev}..HEAD`, "--", dir).split("\n").filter(Boolean);
	const subjects: string[] = [];
	for (const sha of shas) {
		const files = git("show", "--name-only", "--format=", sha, "--", dir).split("\n").filter(Boolean);
		// Exclude only the version bump itself: metadata-only AND the
		// version field changed. Other metadata-only commits (compat
		// vouches, description edits) are user-facing and stay listed.
		const metadataOnly = files.length > 0 && files.every((f) => f === path.join(dir, "metadata.json"));
		const versionChanged =
			metadataOnly &&
			git("show", "--format=", sha, "--", path.join(dir, "metadata.json"))
				.split("\n")
				.some((l) => /^[+-]\s*"version"/.test(l));
		if (metadataOnly && versionChanged) continue;
		subjects.push(git("show", "--format=%s", "--no-patch", sha));
	}
	return subjects;
}

const changes = changesSincePreviousRelease();

const lines = [
	`**${meta.name}** ${version}${meta.description ? ` — ${meta.description}` : ""}`,
	"",
	...(authors.length ? [`by ${authors.join(", ")}`, ""] : []),
	...(changes === null
		? []
		: changes.length === 0
			? ["**What changed**", "", "Initial release.", ""]
			: ["**What changed**", "", ...changes.map((s) => `- ${s}`), ""]),
	"Install from the store inside Spotify, or:",
	"",
	"```shell",
	`spicetify pkg install ${name}`,
	"```",
	"",
	"```",
	`${sha}  ${tag}.zip`,
	"```",
	"",
	"The catalog (`vault.json` on `main`) is the source of truth; this",
	"release page hosts the artifact.",
];
console.log(lines.join("\n"));
