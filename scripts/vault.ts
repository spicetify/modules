#!/usr/bin/env node
/**
 * vault - maintain vault.json for the module store.
 *
 * Rich card data (name, description, authors, tags) lives in each
 * artifact's metadata.json; the store cannot download every zip just to
 * render a list. This tool embeds a metadata subset (and the sha256
 * checksum) into each vault entry, sourced from the artifact itself so it
 * cannot drift from what actually installs.
 *
 * usage:
 *   node scripts/vault.ts refresh
 *     Download every artifact, compute missing checksums, and embed the
 *     metadata subset extracted from each zip.
 *   node scripts/vault.ts add <dist-dir> --artifact <url> [--zip <file>]
 *     Record a stitched build: version and metadata come from the dist
 *     dir's metadata.json, the checksum from --zip when given (the file
 *     you are about to upload) or from downloading --artifact.
 *   node scripts/vault.ts pack <dist-dir> [--out <dir>]
 *     Zip a stitched build into <name>@<version>.zip and print its
 *     sha256, ready to upload as a release artifact.
 *   node scripts/vault.ts snippets <snippets.json> [--base <raw-url-prefix>]
 *     Import a classic marketplace snippets.json catalog as inline
 *     css-only vault entries (no artifacts; the vault is the content).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const VAULT_PATH = path.join(process.cwd(), "vault.json");

interface VaultVersionEntry {
	artifacts: string[];
	providers?: string[];
	checksum?: string;
	metadata?: VaultMetadata;
	// Inline content for small css-only modules (snippets); the vault
	// entry is the artifact.
	files?: Record<string, string>;
	updatedAt?: string;
}

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
	// Previews inside the zip are not hotlinkable; only absolute URLs are
	// useful to the store.
	if (typeof meta.preview === "string" && /^https?:\/\//.test(meta.preview)) out.preview = meta.preview;
	// Source and readme links only when absolute; the store refuses
	// anything else anyway.
	if (typeof meta.repository === "string" && meta.repository.startsWith("https://")) out.repository = meta.repository;
	if (typeof meta.readme === "string" && meta.readme.startsWith("https://")) out.readme = meta.readme;
	return out;
};

const today = () => new Date().toISOString().slice(0, 10);

const slugify = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "snippet";

const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function download(url: string): Promise<Buffer> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

function metadataFromZip(zipBytes: Buffer): Record<string, unknown> {
	const dir = mkdtempSync(path.join(tmpdir(), "vault-"));
	const zipPath = path.join(dir, "artifact.zip");
	try {
		writeFileSync(zipPath, zipBytes);
		const raw = execFileSync("unzip", ["-p", zipPath, "metadata.json"], { maxBuffer: 10 * 1024 * 1024 });
		return JSON.parse(raw.toString());
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function loadVault(): { modules: Record<string, { v: Record<string, VaultVersionEntry>; enabled?: string }> } {
	return JSON.parse(readFileSync(VAULT_PATH, "utf8"));
}

function saveVault(vault: unknown): void {
	writeFileSync(VAULT_PATH, `${JSON.stringify(vault, null, "\t")}\n`);
}

async function refresh(): Promise<void> {
	const vault = loadVault();
	for (const [id, mod] of Object.entries(vault.modules)) {
		for (const [version, entry] of Object.entries(mod.v)) {
			const url = entry.artifacts?.[0];
			if (!url) continue;
			process.stdout.write(`${id}@${version}: downloading… `);
			const bytes = await download(url);
			const checksum = sha256(bytes);
			if (entry.checksum && entry.checksum.toLowerCase() !== checksum) {
				throw new Error(`${id}@${version}: checksum mismatch (vault ${entry.checksum}, artifact ${checksum})`);
			}
			entry.checksum = checksum;
			entry.metadata = metadataSubset(metadataFromZip(bytes));
			if (!entry.metadata.preview) {
				console.warn(`warning: ${id}@${version} has no preview (required by the store)`);
			}
			console.log(`ok (${checksum.slice(0, 17)}…)`);
		}
	}
	saveVault(vault);
	console.log(`updated ${VAULT_PATH}`);
}

async function add(distDir: string, artifactUrl: string, zipFile?: string): Promise<void> {
	const meta = JSON.parse(readFileSync(path.join(distDir, "metadata.json"), "utf8"));
	const id: string = meta.name;
	const version: string = meta.version;
	if (!id || !version) throw new Error(`${distDir}/metadata.json must set name and version`);

	const metadata = metadataSubset(meta);
	// Store cards are artwork-first; a previewless entry has no card.
	if (!metadata.preview) {
		throw new Error(`${id}@${version}: metadata.preview (an https URL) is required by the store`);
	}

	const bytes = zipFile ? readFileSync(zipFile) : await download(artifactUrl);
	const vault = loadVault();
	vault.modules[id] ??= { v: {} };
	vault.modules[id].v[version] = {
		artifacts: [artifactUrl],
		providers: [],
		checksum: sha256(bytes),
		metadata,
		updatedAt: today(),
	};
	saveVault(vault);
	console.log(`added ${id}@${version} to ${VAULT_PATH}`);
}

function pack(distDir: string, outDir: string): void {
	const meta = JSON.parse(readFileSync(path.join(distDir, "metadata.json"), "utf8"));
	if (!meta.name || !meta.version) throw new Error(`${distDir}/metadata.json must set name and version`);
	const zipName = `${meta.name}@${meta.version}.zip`;
	const zipPath = path.resolve(outDir, zipName);
	rmSync(zipPath, { force: true });
	// Zip contents at the archive root (metadata.json at top level), the
	// layout installLocal and the daemon-era installers expect.
	execFileSync("zip", ["-qr", zipPath, "."], { cwd: distDir });
	console.log(`${zipPath}
${sha256(readFileSync(zipPath))}`);
}

// Classic marketplace snippets ({title, description, code, preview?})
// become css-only modules with inline files: nothing to host, nothing to
// download, installable straight from the vault entry.
function importSnippets(snippetsPath: string, base: string): void {
	const snippets = JSON.parse(readFileSync(snippetsPath, "utf8")) as Array<{
		title: string;
		description?: string;
		code: string;
		preview?: string;
	}>;
	const vault = loadVault();
	let added = 0;
	let refreshed = 0;
	let skipped = 0;
	const seenIds = new Set<string>();
	for (const snippet of snippets) {
		if (!snippet.title || !snippet.code) continue;
		// Previews are required by the store; a snippet without one
		// would render no card.
		if (!snippet.preview) {
			skipped++;
			continue;
		}
		let slug = slugify(snippet.title);
		// "snippet-user-*" is reserved for in-client user snippets.
		if (slug.startsWith("user-")) slug = `catalog-${slug}`;
		let id = `snippet-${slug}`;
		// Colliding titles must not silently collapse into one entry.
		for (let n = 2; seenIds.has(id); n++) id = `snippet-${slug}-${n}`;
		seenIds.add(id);
		const existing = vault.modules[id]?.v?.["1.0.0"];
		const metadata: VaultMetadata = {
			name: snippet.title,
			description: snippet.description ?? "",
			// The source catalog carries no authors; never clobber ones
			// already curated into the vault (recovered from marketplace
			// git history) with the fallback.
			authors: existing?.metadata?.authors ?? ["spicetify"],
			tags: ["snippet"],
		};
		metadata.preview = /^https?:\/\//.test(snippet.preview) ? snippet.preview : `${base}${snippet.preview}`;
		const unchanged = existing?.files?.["index.css"] === snippet.code;
		vault.modules[id] ??= { v: {} };
		vault.modules[id].v["1.0.0"] = {
			artifacts: [],
			files: { "index.css": snippet.code },
			metadata,
			updatedAt: unchanged ? (existing?.updatedAt ?? today()) : today(),
		};
		if (existing) refreshed++;
		else added++;
	}
	saveVault(vault);
	console.log(`snippets: ${added} added, ${refreshed} refreshed, ${skipped} skipped (no preview) -> ${VAULT_PATH}`);
}

async function main(): Promise<void> {
	const [cmd, ...rest] = process.argv.slice(2);
	if (cmd === "refresh") return refresh();
	if (cmd === "snippets") {
		const file = rest.find((a) => !a.startsWith("--"));
		const baseIdx = rest.indexOf("--base");
		if (!file) throw new Error("usage: vault.ts snippets <snippets.json> [--base <raw-url-prefix>]");
		return importSnippets(
			file,
			baseIdx >= 0
				? rest[baseIdx + 1]
				: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/",
		);
	}
	if (cmd === "pack") {
		const distDir = rest.find((a) => !a.startsWith("--"));
		const outIdx = rest.indexOf("--out");
		if (!distDir) throw new Error("usage: vault.ts pack <dist-dir> [--out <dir>]");
		return pack(distDir, outIdx >= 0 ? rest[outIdx + 1] : ".");
	}
	if (cmd === "add") {
		const distDir = rest.find((a) => !a.startsWith("--"));
		const flag = (name: string) => {
			const i = rest.indexOf(`--${name}`);
			return i >= 0 ? rest[i + 1] : undefined;
		};
		const artifact = flag("artifact");
		if (!distDir || !artifact) throw new Error("usage: vault.ts add <dist-dir> --artifact <url> [--zip <file>]");
		return add(distDir, artifact, flag("zip"));
	}
	throw new Error(
		"usage: vault.ts refresh | pack <dist-dir> [--out <dir>] | add <dist-dir> --artifact <url> [--zip <file>] | snippets <snippets.json>",
	);
}

main().catch((e) => {
	console.error(e.message ?? e);
	process.exit(1);
});
