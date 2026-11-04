/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * module-id - which metadata.json field identifies a module. `id` is the
 * kebab-case identifier and `name` is the display name. Metadata without
 * `id` predates the split, so its `name` is still the identifier: artifacts
 * built that way, including third-party ones in the vault, keep resolving to
 * the same module.
 */

export const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function moduleIdOf(meta: unknown): string | undefined {
	if (typeof meta !== "object" || meta === null) return undefined;
	const m = meta as Record<string, unknown>;
	const id = "id" in m ? m.id : m.name;
	return typeof id === "string" && id ? id : undefined;
}

// The starting display name for a new module: its id in title case
// ("full-app-display" becomes "Full App Display"). Authors can change it.
export function displayNameFor(id: string): string {
	return id
		.split("-")
		.map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
		.join(" ");
}

export const MAX_DISPLAY_NAME = 64;

// Display names may use Latin letters with accents ("Pokémon") but nothing
// that only looks Latin (Cyrillic or Greek homoglyphs) and no invisible,
// control or bidi characters: with its accents removed, a name has to be
// printable ASCII. Folding the same way makes "Pokémon" and "Pokemon" one
// name when names are compared.
export function foldDisplayName(name: string): string {
	return name.normalize("NFKD").replace(/\p{M}/gu, "");
}

export function displayNameIssue(name: string): string | undefined {
	if (!name.trim()) return "must not be empty";
	if (name.length > MAX_DISPLAY_NAME) return `must be at most ${MAX_DISPLAY_NAME} characters`;
	const folded = foldDisplayName(name);
	if (!/^[\x20-\x7e]+$/.test(folded)) return "may only use printable Latin characters";
	if (!/[a-z0-9]/i.test(folded)) return "must contain a letter or digit";
	return undefined;
}

// What a name reads as, for telling whether two names collide.
export function displayNameKey(text: string): string {
	return foldDisplayName(text)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}
