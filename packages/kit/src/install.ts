/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * install - sideload a packed module (or a dist dir) into a running client.
 *
 * One-shot CDP hot-push via Spicetify.Modules.installLocal, reusing the dev
 * loop's push machinery. Nothing is written to the spicetify config folder.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatPushResult, push, record } from "./push.ts";

const USAGE = "spicetify-kit install <zip|dist-dir> [--port 9229]\n  (requires `unzip` on PATH for a .zip)";

function unzipTo(zipPath: string, dest: string): void {
	try {
		execFileSync("unzip", ["-q", "-o", zipPath, "-d", dest], { stdio: "ignore" });
	} catch {
		throw new Error("`unzip` is required to install a .zip but was not found on PATH");
	}
}

export async function runInstall(argv: string[], cwd = process.cwd()): Promise<void> {
	const target = argv.find((a) => !a.startsWith("--"));
	const flag = (n: string) => {
		const i = argv.indexOf(`--${n}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const port = flag("port") ?? "9229";
	if (!target) throw new Error(USAGE);

	const abs = path.resolve(cwd, target);
	if (!existsSync(abs)) throw new Error(`${target} not found`);

	let distDir = abs;
	let tmp: string | null = null;
	if (statSync(abs).isFile() && abs.endsWith(".zip")) {
		tmp = mkdtempSync(path.join(tmpdir(), "kit-install-"));
		unzipTo(abs, tmp);
		distDir = tmp;
	}

	try {
		if (!existsSync(path.join(distDir, "metadata.json"))) {
			throw new Error(`no metadata.json in ${target} (not a built/packed module)`);
		}
		const meta = JSON.parse(readFileSync(path.join(distDir, "metadata.json"), "utf8"));
		const id: string = meta.name;
		const raw = await push(record(distDir, id), id, port);
		const result = formatPushResult(raw);
		console.log(`[install] ${id} ${result.message}`);
		if (!result.ok) process.exitCode = 1;
	} finally {
		if (tmp) rmSync(tmp, { recursive: true, force: true });
	}
}
