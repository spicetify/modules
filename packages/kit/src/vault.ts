/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * vault - record a built module into a vault file for the module store.
 *
 * Card data (name, description, authors, tags) is embedded from the dist
 * dir's own metadata.json so it cannot drift from what installs, alongside a
 * sha256 checksum of the artifact.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const USAGE = "spicetify-kit vault add <dist-dir> --artifact <url> [--zip <file>] [--vault <path>]";

interface VaultMetadata {
	name?: string;
	description?: string;
	authors?: string[];
	tags?: string[];
	preview?: string;
	repository?: string;
	readme?: string;
}

const metadataSubset = (meta: Record<string, unknown>): VaultMetadata => {
	const out: VaultMetadata = {};
	if (typeof meta.name === "string") out.name = meta.name;
	if (typeof meta.description === "string") out.description = meta.description;
	if (Array.isArray(meta.authors)) out.authors = meta.authors as string[];
	if (Array.isArray(meta.tags)) out.tags = meta.tags as string[];
	if (typeof meta.preview === "string" && /^https?:\/\//.test(meta.preview)) out.preview = meta.preview;
	if (typeof meta.repository === "string" && meta.repository.startsWith("https://")) out.repository = meta.repository;
	if (typeof meta.readme === "string" && meta.readme.startsWith("https://")) out.readme = meta.readme;
	return out;
};

const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const today = () => new Date().toISOString().slice(0, 10);

async function download(url: string): Promise<Buffer> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

export async function runVault(argv: string[], cwd = process.cwd()): Promise<void> {
	const [cmd, ...rest] = argv;
	if (cmd !== "add") throw new Error(USAGE);

	const distArg = rest.find((a) => !a.startsWith("--"));
	const flag = (n: string) => {
		const i = rest.indexOf(`--${n}`);
		return i >= 0 ? rest[i + 1] : undefined;
	};
	const artifact = flag("artifact");
	if (!distArg || !artifact) throw new Error(USAGE);

	const distDir = path.resolve(cwd, distArg);
	const meta = JSON.parse(readFileSync(path.join(distDir, "metadata.json"), "utf8"));
	const id: string = meta.name;
	const version: string = meta.version;
	if (!id || !version) throw new Error(`${distArg}/metadata.json must set name and version`);

	const zip = flag("zip");
	const bytes = zip ? readFileSync(path.resolve(cwd, zip)) : await download(artifact);
	const checksum = sha256(bytes);

	const vaultPath = path.resolve(cwd, flag("vault") ?? "vault.json");
	// KTD3 divergence: initialize an empty vault when the target is absent (the
	// monorepo script assumes one already exists).
	const vault: { modules: Record<string, { v: Record<string, unknown>; enabled?: string }> } = existsSync(vaultPath)
		? JSON.parse(readFileSync(vaultPath, "utf8"))
		: { modules: {} };
	vault.modules ??= {};
	vault.modules[id] ??= { v: {} };

	// KTD3 divergence: abort on a checksum mismatch against an existing entry
	// (the monorepo `add` overwrites unconditionally; only `refresh` verifies).
	const existing = vault.modules[id].v[version] as { checksum?: string } | undefined;
	if (existing?.checksum && existing.checksum.toLowerCase() !== checksum.toLowerCase()) {
		throw new Error(
			`${id}@${version}: checksum mismatch (vault ${existing.checksum}, artifact ${checksum}); refusing to overwrite`,
		);
	}

	vault.modules[id].v[version] = {
		artifacts: [artifact],
		providers: [],
		checksum,
		metadata: metadataSubset(meta),
		updatedAt: today(),
	};
	writeFileSync(vaultPath, `${JSON.stringify(vault, null, "\t")}\n`);
	console.log(`added ${id}@${version} to ${vaultPath}`);
}
