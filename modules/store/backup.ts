/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Store data: what a backup carries, and what it deliberately does not.
 *
 * A backup carries preferences and the list of modules that were installed.
 * It never carries module files. The records under
 * `spicetify.modules.local.*` ARE the code the loader executes, so a format
 * that restored them verbatim would turn an imported file into an installer:
 * one file picker, no vault, no checksum, no review. Restoring reinstalls
 * from the vault instead, through the same verified path as any other
 * install.
 *
 * Dependency-free so it can be unit tested; the page owns the localStorage
 * and catalog calls.
 */

const LOCAL_PREFIX = "spicetify.modules.local.";
export const OWNED_PREFIXES = [LOCAL_PREFIX, "spicetify:scheme:"];
// Endpoint overrides are deliberately excluded from backups: importing a
// crafted file must never be able to repoint the vault, the CORS proxy, or
// the installs API (which receives the session token). Setting those stays a
// manual, deliberate act.
export const ENDPOINT_KEYS = ["spicetify:defaultVaultUrl", "spicetify:corsProxyTemplate", "spicetify:installsApiUrl"];
// The loader's own persisted choices live here too: which theme is active and
// which modules the user turned off. They are preferences, so a backup carries
// them and a reset clears them — a reset that deletes every theme record but
// keeps the active-theme pointer leaves it naming a theme that is gone.
const PREF_KEYS = [
	"spicetify:store:sort",
	"spicetify:store:tab",
	"spicetify:modules:activeTheme",
	"spicetify:modules:disabled",
];

export const BACKUP_FORMAT = "spicetify-store-backup";
export const BACKUP_VERSION = 2;

export const isPrefKey = (key: string) => PREF_KEYS.includes(key) || key.startsWith("spicetify:scheme:");

/** Everything the store owns, which is what a reset clears. */
export const isOwnedKey = (key: string) =>
	isPrefKey(key) || ENDPOINT_KEYS.includes(key) || OWNED_PREFIXES.some((p) => key.startsWith(p));

// A snippet a user wrote in the store's editor exists only in localStorage
// and is in no registry, so an id alone cannot restore it. Its stylesheet
// travels with the backup; nothing executable does, which is what keeps an
// imported file from being an installer.
export type BackupSnippet = { id: string; name?: string; css: string };
export type BackupPlan = { prefs: Record<string, string>; modules: string[]; snippets: BackupSnippet[] };

export const USER_SNIPPET_PREFIX = "snippet-user-";

export function serializeBackup(
	prefs: Record<string, string>,
	modules: string[],
	snippets: BackupSnippet[] = [],
): string {
	return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, prefs, modules, snippets }, null, "\t");
}

/**
 * Reads either format. A version 1 file carries whole module records; only
 * the ids are taken from it, by reading the key names, so an old backup
 * still restores as a list of things to fetch from the vault and none of its
 * payload is ever written back.
 */
export function parseBackup(text: string): BackupPlan {
	const data = JSON.parse(text) as {
		format?: string;
		prefs?: Record<string, unknown>;
		modules?: unknown;
		snippets?: unknown;
		keys?: Record<string, unknown>;
	};
	if (data.format !== BACKUP_FORMAT) throw new Error("not a store backup");

	const prefs: Record<string, string> = {};
	for (const [key, value] of Object.entries(data.prefs ?? data.keys ?? {})) {
		if (isPrefKey(key) && typeof value === "string") prefs[key] = value;
	}

	const modules = new Set<string>();
	for (const id of Array.isArray(data.modules) ? data.modules : []) {
		if (typeof id === "string" && id) modules.add(id);
	}

	const snippets: BackupSnippet[] = [];
	const seen = new Set<string>();
	const takeSnippet = (id: string, name: unknown, css: unknown) => {
		// Only stylesheets, and only under the user-snippet prefix: a crafted
		// file must not be able to hand the loader anything it would execute.
		if (!id.startsWith(USER_SNIPPET_PREFIX) || typeof css !== "string" || seen.has(id)) return;
		seen.add(id);
		snippets.push({ id, ...(typeof name === "string" ? { name } : {}), css });
	};
	for (const s of Array.isArray(data.snippets) ? data.snippets : []) {
		const entry = s as { id?: unknown; name?: unknown; css?: unknown };
		if (typeof entry?.id === "string") takeSnippet(entry.id, entry.name, entry.css);
	}
	// A version 1 file carries whole module records. Its user snippets are
	// recoverable from the inline stylesheet; everything else in the record
	// is discarded, and only the id survives.
	for (const [key, value] of Object.entries(data.keys ?? {})) {
		if (!key.startsWith(LOCAL_PREFIX)) continue;
		const id = key.slice(LOCAL_PREFIX.length);
		if (id.startsWith(USER_SNIPPET_PREFIX)) {
			try {
				const record = JSON.parse(String(value)) as {
					metadata?: { name?: unknown };
					files?: Record<string, unknown>;
				};
				takeSnippet(id, record?.metadata?.name, record?.files?.["index.css"]);
			} catch {
				/* an unreadable record is simply not restorable */
			}
			continue;
		}
		modules.add(id);
	}
	return { prefs, modules: [...modules], snippets };
}
