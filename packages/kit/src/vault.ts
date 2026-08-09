/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * vault - record a built module into a vault file for the module store.
 *
 * Card data (name, description, authors, tags) is embedded at the module
 * level from the dist dir's own metadata.json so it cannot drift from what
 * installs, alongside a per-version sha256 checksum of the artifact.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const USAGE =
	"spicetify-kit vault add <dist-dir> --artifact <url> [--zip <file>] [--vault <path>]\n  (default target: vault/<id>.json, the shape a store submission takes)";

// Every author may carry their own GitHub username; plain names in
// metadata.json normalize to { name }.
interface VaultAuthor {
	name: string;
	github?: string;
}

interface VaultMetadata {
	name?: string;
	description?: string;
	authors?: VaultAuthor[];
	tags?: string[];
	preview?: string;
	repository?: string;
	readme?: string;
	// SPDX identifier: the registry requires one, and the store shows it
	// next to the install button.
	license?: string;
}

const normalizeAuthors = (authors: unknown[]): VaultAuthor[] =>
	authors.flatMap((a) => {
		if (typeof a === "string") return [{ name: a }];
		if (a && typeof a === "object" && typeof (a as VaultAuthor).name === "string") {
			const { name, github } = a as VaultAuthor;
			return [{ name, ...(typeof github === "string" ? { github } : {}) }];
		}
		return [];
	});

const metadataSubset = (meta: Record<string, unknown>): VaultMetadata => {
	const out: VaultMetadata = {};
	if (typeof meta.name === "string") out.name = meta.name;
	if (typeof meta.description === "string") out.description = meta.description;
	if (Array.isArray(meta.authors)) out.authors = normalizeAuthors(meta.authors);
	if (Array.isArray(meta.tags)) out.tags = meta.tags as string[];
	if (typeof meta.preview === "string" && /^https?:\/\//.test(meta.preview)) out.preview = meta.preview;
	if (typeof meta.repository === "string" && meta.repository.startsWith("https://")) out.repository = meta.repository;
	if (typeof meta.readme === "string" && meta.readme.startsWith("https://")) out.readme = meta.readme;
	if (typeof meta.license === "string" && meta.license.trim()) out.license = meta.license.trim();
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

	// One file per module, which is exactly what a submission to the
	// registry is: vault/<id>.json holding this module and nothing else.
	const vaultPath = path.resolve(cwd, flag("vault") ?? path.join("vault", `${id}.json`));
	const module: { metadata?: VaultMetadata; v: Record<string, unknown>; enabled?: string } = existsSync(vaultPath)
		? JSON.parse(readFileSync(vaultPath, "utf8"))
		: { v: {} };
	module.v ??= {};

	// A published version is immutable: its checksum is what every install
	// of it was verified against, so re-pointing it at different bytes is
	// refused here as well as by the registry's validator.
	const existing = module.v[version] as { checksum?: string } | undefined;
	if (existing?.checksum && existing.checksum.toLowerCase() !== checksum.toLowerCase()) {
		throw new Error(
			`${id}@${version}: checksum mismatch (vault ${existing.checksum}, artifact ${checksum}); refusing to overwrite`,
		);
	}

	module.v[version] = {
		artifacts: [artifact],
		providers: [],
		checksum,
		updatedAt: today(),
	};
	// Card data lives at the module level (one identity per module); an
	// add records the newest release, so the card follows it. Curated
	// per-author github attribution usually doesn't come from the
	// artifact and must survive the rewrite (artifact-declared wins).
	const prev = module.metadata;
	const next = metadataSubset(meta);
	if (prev?.authors?.length && next.authors?.length) {
		const curated = new Map(prev.authors.filter((a) => a.github).map((a) => [a.name, a.github as string]));
		next.authors = next.authors.map((a) =>
			!a.github && curated.has(a.name) ? { ...a, github: curated.get(a.name) } : a,
		);
	}
	module.metadata = next;
	mkdirSync(path.dirname(vaultPath), { recursive: true });
	writeFileSync(vaultPath, `${JSON.stringify(module, null, "\t")}\n`);
	console.log(`added ${id}@${version} to ${vaultPath}`);
}
