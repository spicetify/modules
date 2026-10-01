/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * vault-metadata - the store card a vault entry carries, derived from a
 * module's metadata.json. `spicetify-kit vault add`, the registry's
 * scripts/vault.ts, and its submission validator all build the card here.
 */

// Every author may carry their own GitHub username. `github` is
// vault-curated (recovered from marketplace git history) unless the
// artifact's metadata.json already declares author objects.
export interface VaultAuthor {
	name: string;
	github?: string;
}

const KINDS = ["extension", "theme", "snippet", "app", "lib"] as const;
export type VaultKind = (typeof KINDS)[number];

export interface VaultMetadata {
	name?: string;
	description?: string;
	authors?: VaultAuthor[];
	kind?: VaultKind;
	preview?: string;
	repository?: string;
	readme?: string;
	// SPDX identifier, shown on the card. The store is the only channel
	// for third-party code, so what a user is agreeing to install has to
	// travel with the entry.
	license?: string;
}

// A submission may declare `kind` or, if it predates the migration, the old
// `tags` list; either way the vault records exactly one kind.
export const kindOfMeta = (meta: Record<string, unknown>): VaultKind | undefined => {
	if (typeof meta.kind === "string" && (KINDS as readonly string[]).includes(meta.kind)) {
		return meta.kind as VaultKind;
	}
	const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
	return KINDS.find((kind) => tags.includes(kind));
};

// kindOfMeta as JavaScript source, for expressions evaluated inside the
// client where kit code cannot be imported. It also accepts a missing meta.
export const KIND_OF_META_SOURCE = `((meta) => {
	const kinds = ${JSON.stringify(KINDS)};
	if (typeof meta?.kind === "string" && kinds.includes(meta.kind)) return meta.kind;
	const tags = Array.isArray(meta?.tags) ? meta.tags : [];
	return kinds.find((kind) => tags.includes(kind));
})`;

// metadata.json authors are plain names; author objects (with a github)
// pass through, so an artifact may declare either.
const normalizeAuthors = (authors: unknown[]): VaultAuthor[] =>
	authors.flatMap((a) => {
		if (typeof a === "string") return [{ name: a }];
		if (a && typeof a === "object" && typeof (a as VaultAuthor).name === "string") {
			const { name, github } = a as VaultAuthor;
			return [{ name, ...(typeof github === "string" ? { github } : {}) }];
		}
		return [];
	});

export const metadataSubset = (meta: Record<string, unknown>): VaultMetadata => {
	const out: VaultMetadata = {};
	if (typeof meta.name === "string") out.name = meta.name;
	if (typeof meta.description === "string") out.description = meta.description;
	if (Array.isArray(meta.authors)) out.authors = normalizeAuthors(meta.authors);
	const kind = kindOfMeta(meta);
	if (kind) out.kind = kind;
	// Previews inside the zip are not hotlinkable; only absolute URLs are
	// useful to the store.
	if (typeof meta.preview === "string" && /^https?:\/\//.test(meta.preview)) out.preview = meta.preview;
	// Source and readme links only when absolute; the store refuses
	// anything else anyway.
	if (typeof meta.repository === "string" && meta.repository.startsWith("https://")) out.repository = meta.repository;
	if (typeof meta.readme === "string" && meta.readme.startsWith("https://")) out.readme = meta.readme;
	if (typeof meta.license === "string" && meta.license.trim()) out.license = meta.license.trim();
	return out;
};
