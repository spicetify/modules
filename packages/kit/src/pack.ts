/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * pack - zip a built module into <name>@<version>.zip and print its
 * sha256, ready to upload as a release artifact.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const USAGE = "spicetify-kit pack <dist-dir> [--out <dir>]";

export async function runPack(argv: string[], cwd = process.cwd()): Promise<void> {
	const distDir = argv.find((a) => !a.startsWith("--"));
	const outIdx = argv.indexOf("--out");
	if (!distDir) throw new Error(USAGE);
	const outDir = outIdx >= 0 ? argv[outIdx + 1] : ".";

	const abs = path.resolve(cwd, distDir);
	const meta = JSON.parse(readFileSync(path.join(abs, "metadata.json"), "utf8"));
	if (!meta.name || !meta.version) throw new Error(`${distDir}/metadata.json must set name and version`);
	const zipPath = path.resolve(cwd, outDir, `${meta.name}@${meta.version}.zip`);
	rmSync(zipPath, { force: true });
	// Zip contents at the archive root (metadata.json at top level), the
	// layout installLocal and the module installers expect.
	execFileSync("zip", ["-qr", zipPath, "."], { cwd: abs });
	const digest = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
	console.log(`${zipPath}\nsha256:${digest}`);
}
