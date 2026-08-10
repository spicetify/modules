#!/usr/bin/env node
/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * vault-build - compose vault.json from the per-module sources in vault/.
 *
 * vault/<id>.json is the reviewable unit: one file per module, so two
 * submissions never touch the same file and a review diff is the module
 * being submitted and nothing else. vault.json is the built artifact the
 * store and the CLI fetch, rebuilt and committed after a merge.
 *
 * usage:
 *   node scripts/vault-build.ts            rebuild vault.json
 *   node scripts/vault-build.ts --check    fail if vault.json is stale
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_DIR = "vault";
export const VAULT_FILE = "vault.json";
// Revocations are a curated kill switch, not module data: keeping them out
// of vault/ means a revoked module's own file stays exactly what its author
// submitted.
export const REVOKED_FILE = "revoked.json";

export type VaultVersionEntry = {
	artifacts?: string[];
	providers?: string[];
	checksum?: string;
	files?: Record<string, string>;
	updatedAt?: string;
	hidden?: boolean;
};

export type VaultModule = {
	metadata?: Record<string, unknown>;
	enabled?: string;
	v: Record<string, VaultVersionEntry>;
};

export type Vault = { modules: Record<string, VaultModule>; revoked?: Record<string, string> };

const idOf = (file: string) => path.basename(file, ".json");

/** Every module id with a source file, sorted so the build is deterministic. */
export function sourceIds(root = process.cwd()): string[] {
	const dir = path.join(root, SOURCE_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.map(idOf)
		.sort();
}

export const sourcePath = (id: string, root = process.cwd()) => path.join(root, SOURCE_DIR, `${id}.json`);

export function readModule(id: string, root = process.cwd()): VaultModule {
	const parsed = JSON.parse(readFileSync(sourcePath(id, root), "utf8"));
	if (!parsed || typeof parsed !== "object" || typeof parsed.v !== "object" || parsed.v === null) {
		throw new Error(`${SOURCE_DIR}/${id}.json: expected a module object with a "v" map`);
	}
	return parsed as VaultModule;
}

/** The aggregate the store fetches, composed from the per-module sources. */
export function compose(root = process.cwd()): Vault {
	const modules: Record<string, VaultModule> = {};
	for (const id of sourceIds(root)) modules[id] = readModule(id, root);

	const revokedPath = path.join(root, REVOKED_FILE);
	if (!existsSync(revokedPath)) return { modules };
	const revoked = JSON.parse(readFileSync(revokedPath, "utf8")) as Record<string, string>;
	return Object.keys(revoked).length ? { modules, revoked } : { modules };
}

/**
 * Serialize the way the repo's formatter would, so a rebuild never shows up
 * as whitespace churn and --check compares content rather than style.
 * Best-effort: the output is valid JSON whether or not oxfmt is installed.
 */
export function serialize(value: unknown, root = process.cwd()): string {
	const raw = `${JSON.stringify(value, null, "\t")}\n`;
	const dir = mkdtempSync(path.join(tmpdir(), "vault-build-"));
	const scratch = path.join(dir, "vault.json");
	try {
		writeFileSync(scratch, raw);
		execFileSync(path.join(root, "node_modules", ".bin", "oxfmt"), [scratch], { stdio: "ignore" });
		return readFileSync(scratch, "utf8");
	} catch {
		return raw;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Writes vault.json. Returns true when the file actually changed. */
export function build(root = process.cwd()): boolean {
	const target = path.join(root, VAULT_FILE);
	const next = serialize(compose(root), root);
	const current = existsSync(target) ? readFileSync(target, "utf8") : "";
	if (current === next) return false;
	writeFileSync(target, next);
	return true;
}

function main(): void {
	const check = process.argv.includes("--check");
	const root = process.cwd();
	if (!check) {
		const changed = build(root);
		console.log(changed ? `vault-build: rebuilt ${VAULT_FILE}` : `vault-build: ${VAULT_FILE} already current`);
		return;
	}

	const target = path.join(root, VAULT_FILE);
	const next = serialize(compose(root), root);
	const current = existsSync(target) ? readFileSync(target, "utf8") : "";
	if (current === next) {
		console.log(`vault-build: ${VAULT_FILE} is current (${sourceIds(root).length} modules)`);
		return;
	}
	console.error(`vault-build: ${VAULT_FILE} is stale; run \`node scripts/vault-build.ts\` and commit the result`);
	process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
