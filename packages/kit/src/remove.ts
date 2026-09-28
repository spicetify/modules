/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * remove - drop a hot-pushed local override from a running client, so it
 * falls back to the staged or store-installed copy. Takes a module directory
 * (its metadata.json names the id) or the id itself.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { formatRemoveOutcome, removeLocal, resolvePort } from "./push.ts";

const USAGE = "spicetify-kit remove <module-dir|id> [--port 9229]";

// moduleId reads the id from <target>/metadata.json when target is a module
// directory, and otherwise treats target as the id.
export function moduleId(target: string, cwd: string): string {
	const meta = path.join(path.resolve(cwd, target), "metadata.json");
	if (!existsSync(meta)) return target;
	const name: unknown = JSON.parse(readFileSync(meta, "utf8")).name;
	if (typeof name !== "string" || !name) throw new Error(`${meta} has no "name" to identify the module by`);
	return name;
}

export async function runRemove(argv: string[], cwd = process.cwd()): Promise<void> {
	const target = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--port");
	if (!target || argv.includes("--help") || argv.includes("-h")) {
		console.log(USAGE);
		if (!target) process.exitCode = 1;
		return;
	}
	const i = argv.indexOf("--port");
	const port = resolvePort(i >= 0 ? argv[i + 1] : undefined);
	const id = moduleId(target, cwd);
	console.log(`[remove] ${formatRemoveOutcome(id, await removeLocal(id, port))}`);
}
