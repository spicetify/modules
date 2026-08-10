#!/usr/bin/env node
/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * mirror-artifacts - keep a copy of every published artifact under our own
 * releases.
 *
 * The vault indexes URLs on hosts this org does not control. A checksum
 * proves the bytes are the right ones; it cannot produce them again once an
 * author deletes a release asset or lets a domain lapse, and every install of
 * that version breaks at once. So each verified artifact is re-uploaded to a
 * `mirror/<id>` release here and the mirror URL is appended to the entry;
 * installers walk the list in order, author's host first.
 *
 * Requires the `gh` CLI (authenticated) and runs after a submission merges.
 *
 * usage:
 *   node scripts/mirror-artifacts.ts [--dry-run] [--id <module>]
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { downloadCapped } from "./download.ts";
import { build, readModule, serialize, sourceIds, sourcePath } from "./vault-build.ts";

const MIRROR_REPO = process.env.MIRROR_REPO ?? "spicetify/modules";
const MIRROR_HOST = `https://github.com/${MIRROR_REPO}/releases/download`;

export const mirrorTag = (id: string) => `mirror/${id}`;
export const mirrorAsset = (id: string, version: string) => `${id}@${version}.zip`;
export const mirrorUrl = (id: string, version: string) => `${MIRROR_HOST}/${mirrorTag(id)}/${mirrorAsset(id, version)}`;

/**
 * An entry needs mirroring when it points somewhere we do not control and
 * has no copy here yet. Inline entries have nothing to fetch, and a module
 * published from this repository is already hosted by us, so neither gains
 * anything from a second copy.
 */
export function needsMirror(id: string, version: string, artifacts: string[]): boolean {
	const primary = artifacts[0];
	if (!primary) return false;
	if (primary.startsWith(MIRROR_HOST)) return false;
	return !artifacts.includes(mirrorUrl(id, version));
}

const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Same cap as the validator: these URLs are third-party too, and this job
// runs on every push.
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

const fetchArtifact = (url: string): Promise<Buffer> => downloadCapped(url, MAX_ARTIFACT_BYTES);

async function main(): Promise<void> {
	const dryRun = process.argv.includes("--dry-run");
	const only = process.argv.indexOf("--id") >= 0 ? process.argv[process.argv.indexOf("--id") + 1] : undefined;

	let mirrored = 0;
	let skipped = 0;
	for (const id of sourceIds()) {
		if (only && id !== only) continue;
		const mod = readModule(id);
		let changed = false;
		for (const [version, entry] of Object.entries(mod.v)) {
			const artifacts = entry.artifacts ?? [];
			if (!needsMirror(id, version, artifacts)) continue;
			const url = mirrorUrl(id, version);
			const primary = artifacts[0]!;
			if (dryRun) {
				console.log(`would mirror ${id}@${version} from ${primary}`);
				mirrored++;
				continue;
			}
			// Nothing is mirrored unverified: an artifact whose checksum no
			// longer matches must not be given a second, more durable home.
			let bytes: Buffer;
			try {
				bytes = await fetchArtifact(primary);
			} catch (e) {
				console.warn(`skip ${id}@${version}: ${(e as Error).message}`);
				skipped++;
				continue;
			}
			if (entry.checksum && sha256(bytes).toLowerCase() !== entry.checksum.toLowerCase()) {
				console.warn(`skip ${id}@${version}: checksum mismatch, refusing to mirror`);
				skipped++;
				continue;
			}

			const dir = mkdtempSync(path.join(tmpdir(), "mirror-"));
			try {
				const file = path.join(dir, mirrorAsset(id, version));
				writeFileSync(file, bytes);
				// One release per module, one asset per version: a create
				// that loses the race to an existing tag still uploads.
				try {
					gh([
						"release",
						"create",
						mirrorTag(id),
						"--repo",
						MIRROR_REPO,
						"--title",
						`${id} artifact mirror`,
						"--notes",
						`Byte-for-byte copies of published ${id} artifacts, kept so installs survive an upstream host going away.`,
					]);
				} catch {
					/* the release already exists */
				}
				gh(["release", "upload", mirrorTag(id), file, "--repo", MIRROR_REPO, "--clobber"]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}

			entry.artifacts = [...artifacts, url];
			changed = true;
			mirrored++;
			console.log(`mirrored ${id}@${version}`);
		}
		if (changed && !dryRun) writeFileSync(sourcePath(id), serialize(mod));
	}

	if (mirrored && !dryRun) build();
	console.log(`mirror-artifacts: ${mirrored} mirrored, ${skipped} skipped`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
