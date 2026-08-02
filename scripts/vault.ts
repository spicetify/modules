#!/usr/bin/env node
/**
 * vault - maintain vault.json for the module store.
 *
 * Rich card data (name, description, authors, tags) lives in each
 * artifact's metadata.json; the store cannot download every zip just to
 * render a list. This tool embeds a metadata subset at the module level
 * (one card identity per module, tracking the newest version's artifact)
 * and a sha256 checksum per version entry, sourced from the artifact
 * itself so neither can drift from what actually installs.
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
	// Inline content for small css-only modules (snippets); the vault
	// entry is the artifact.
	files?: Record<string, string>;
	updatedAt?: string;
	// Infrastructure modules (stdlib) are installable/updatable but
	// never render as store cards.
	hidden?: boolean;
}

// Card data (metadata) lives at the module level: a module has one
// identity in the store regardless of how many releases it carries.
// Writers keep it in sync with the newest version's artifact.
interface VaultModule {
	metadata?: VaultMetadata;
	enabled?: string;
	v: Record<string, VaultVersionEntry>;
}

interface VaultMetadata {
	name?: string;
	description?: string;
	authors?: string[];
	// GitHub username of the (first) author, when known. Vault-curated
	// (recovered from marketplace git history); never sourced from the
	// artifact, so metadataSubset does not carry it.
	github?: string;
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

function loadVault(): { modules: Record<string, VaultModule> } {
	return JSON.parse(readFileSync(VAULT_PATH, "utf8"));
}

// Curated fields (github attribution) never come from artifacts; carry
// them across metadata rewrites so an update cannot drop them.
const withCurated = (next: VaultMetadata, prev?: VaultMetadata): VaultMetadata =>
	prev?.github ? { ...next, github: prev.github } : next;

const newestVersion = (versions: string[]): string | undefined =>
	[...versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);

function saveVault(vault: unknown): void {
	writeFileSync(VAULT_PATH, `${JSON.stringify(vault, null, "\t")}\n`);
	// oxfmt owns the repo's JSON style (inline primitive arrays);
	// JSON.stringify alone rewrites the whole file's formatting and
	// drowns every data change in whitespace churn. Best-effort: the
	// file is valid JSON either way.
	try {
		execFileSync(path.join(process.cwd(), "node_modules", ".bin", "oxfmt"), [VAULT_PATH], { stdio: "ignore" });
	} catch {
		console.warn("warning: oxfmt unavailable; vault.json left in JSON.stringify formatting");
	}
}

async function refresh(): Promise<void> {
	const vault = loadVault();
	for (const [id, mod] of Object.entries(vault.modules)) {
		// The module's card metadata tracks its newest version's artifact.
		const newest = newestVersion(Object.keys(mod.v));
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
			if (version === newest) {
				mod.metadata = withCurated(metadataSubset(metadataFromZip(bytes)), mod.metadata);
				if (!mod.metadata.preview) {
					console.warn(`warning: ${id} has no preview (required by the store)`);
				}
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

	const vault = loadVault();
	const existing = vault.modules[id]?.v?.[version];
	// Infrastructure modules declare "hidden": true in metadata.json;
	// they never render as store cards, so no preview is required. A
	// hidden flag curated straight into the vault also survives a
	// re-add of the same version.
	const hidden = meta.hidden === true || existing?.hidden === true || undefined;

	const metadata = metadataSubset(meta);
	// Store cards are artwork-first; a previewless entry has no card.
	if (!metadata.preview && !hidden) {
		throw new Error(`${id}@${version}: metadata.preview (an https URL) is required by the store`);
	}

	const bytes = zipFile ? readFileSync(zipFile) : await download(artifactUrl);
	vault.modules[id] ??= { v: {} };
	vault.modules[id].v[version] = {
		artifacts: [artifactUrl],
		providers: [],
		checksum: sha256(bytes),
		updatedAt: today(),
		...(hidden ? { hidden } : {}),
	};
	// Adds record the newest release, so the module's card follows it.
	vault.modules[id].metadata = withCurated(metadata, vault.modules[id].metadata);
	saveVault(vault);
	console.log(`added ${id}@${version} to ${VAULT_PATH}`);
}

// Add (or update) a single inline css-only snippet. The bulk importer
// migrated the legacy marketplace catalog; this is the first-class
// flow for individual snippets going forward.
function addSnippet(
	name: string,
	cssPath: string,
	preview: string,
	opts: { author?: string; github?: string; description?: string },
): void {
	if (!/^https?:\/\//.test(preview)) {
		throw new Error("snippet: --preview must be an https URL (store cards are artwork-first)");
	}
	const css = readFileSync(cssPath, "utf8");
	if (!css.trim()) throw new Error(`snippet: ${cssPath} is empty`);

	let slug = slugify(name);
	// "snippet-user-*" is reserved for in-client user snippets.
	if (slug.startsWith("user-")) slug = `catalog-${slug}`;
	const id = `snippet-${slug}`;

	const vault = loadVault();
	const existing = vault.modules[id]?.v?.["1.0.0"];
	const prevMeta = vault.modules[id]?.metadata;
	const github = opts.github ?? prevMeta?.github;
	const metadata: VaultMetadata = {
		name,
		description: opts.description ?? prevMeta?.description ?? "",
		// Curated attribution survives an update without --author, same
		// rule as the bulk importer.
		authors: opts.author ? [opts.author] : (prevMeta?.authors ?? ["spicetify"]),
		...(github ? { github } : {}),
		tags: ["snippet"],
		preview,
	};
	const unchanged = existing?.files?.["index.css"] === css;
	vault.modules[id] ??= { v: {} };
	vault.modules[id].metadata = metadata;
	vault.modules[id].v["1.0.0"] = {
		artifacts: [],
		files: { "index.css": css },
		updatedAt: unchanged ? (existing?.updatedAt ?? today()) : today(),
	};
	saveVault(vault);
	console.log(`${existing ? "updated" : "added"} ${id} -> ${VAULT_PATH}`);
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
		const prevMeta = vault.modules[id]?.metadata;
		const metadata: VaultMetadata = {
			name: snippet.title,
			description: snippet.description ?? "",
			// The source catalog carries no authors; never clobber ones
			// already curated into the vault (recovered from marketplace
			// git history) with the fallback.
			authors: prevMeta?.authors ?? ["spicetify"],
			...(prevMeta?.github ? { github: prevMeta.github } : {}),
			tags: ["snippet"],
		};
		metadata.preview = /^https?:\/\//.test(snippet.preview) ? snippet.preview : `${base}${snippet.preview}`;
		const unchanged = existing?.files?.["index.css"] === snippet.code;
		vault.modules[id] ??= { v: {} };
		vault.modules[id].metadata = metadata;
		vault.modules[id].v["1.0.0"] = {
			artifacts: [],
			files: { "index.css": snippet.code },
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
	if (cmd === "snippet") {
		const name = rest.find((a) => !a.startsWith("--"));
		const flag = (n: string) => {
			const i = rest.indexOf(`--${n}`);
			return i >= 0 ? rest[i + 1] : undefined;
		};
		const css = flag("css");
		const preview = flag("preview");
		if (!name || !css || !preview) {
			throw new Error(
				"usage: vault.ts snippet <name> --css <file> --preview <url> [--author <name>] [--github <user>] [--description <text>]",
			);
		}
		return addSnippet(name, css, preview, {
			author: flag("author"),
			github: flag("github"),
			description: flag("description"),
		});
	}
	throw new Error(
		"usage: vault.ts refresh | pack <dist-dir> [--out <dir>] | add <dist-dir> --artifact <url> [--zip <file>] | snippets <snippets.json> [--base <raw-url-prefix>] | snippet <name> --css <file> --preview <url> [--author <name>] [--github <user>] [--description <text>]",
	);
}

main().catch((e) => {
	console.error(e.message ?? e);
	process.exit(1);
});
