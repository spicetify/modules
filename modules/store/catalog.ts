/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// One registry. Modules reach the store by being submitted to it, which is
// what makes every entry reviewable and revocable; code from anywhere else
// installs deliberately, through the CLI, rather than one click inside the
// client.
//
// Overridable for vault development: point at any URL (data: URLs work)
// to preview a vault before publishing it. Read lazily like the other
// overrides so a change applies on the next load, not the next boot.
const DEFAULT_VAULT_URL = () =>
	globalThis.localStorage?.getItem("spicetify:defaultVaultUrl") ??
	"https://raw.githubusercontent.com/spicetify/modules/main/vault.json";

// raw.githubusercontent and the vault hosts are CORS-enabled; github.com
// release downloads are not. Only proxy what needs it, with the raw URL
// substituted (both proxies reject encoded targets).
const needsProxy = (url: string) => url.startsWith("https://github.com/");

// The wrapper owns the proxy chain (local daemon first, hosted as backup) so
// this and CosmosAsync cannot drift. A client whose wrapper predates that API
// still gets the hosted proxy, just without the local one.
const HOSTED_FALLBACK = (url: string) =>
	(
		globalThis.localStorage?.getItem("spicetify:corsProxyTemplate") ?? "https://cors-proxy.spicetify.app/{url}"
	).replace("{url}", url);

export const proxiedFetch = (url: string, init?: RequestInit): Promise<Response> => {
	if (!needsProxy(url)) return fetch(url, init);
	const proxy = globalThis.Spicetify?.CORSProxy?.fetch;
	return proxy ? proxy(url, init) : fetch(HOSTED_FALLBACK(url), init);
};

// Unique-install counts; absent/unreachable degrades to no badges and
// name-ordered sorting, never to an error.
export const INSTALLS_API = () =>
	globalThis.localStorage?.getItem("spicetify:installsApiUrl") ?? "https://installs.spicetify.app";

export type VaultModule = {
	id: string;
	version: string;
	artifacts: string[];
	// Inline content: small modules (css snippets) ship their files inside
	// the vault entry and install without any artifact download.
	files?: Record<string, string>;
	checksum?: string;
	vault: string;
	updatedAt?: string;
	// Infrastructure entries (stdlib) are installable/updatable but
	// never render as store cards.
	hidden?: boolean;
	meta?: {
		name?: string;
		description?: string;
		// Each author may carry their own GitHub username; the details
		// dialog links those names to their profiles.
		authors?: Array<{ name: string; github?: string }>;
		tags?: string[];
		preview?: string;
		repository?: string;
		readme?: string;
		// SPDX identifier: what the user is agreeing to install, shown in
		// the details dialog.
		license?: string;
	};
};

// ok: the vault answered; a failed load must not latch an empty catalog.
export type Catalog = { modules: VaultModule[]; revoked: Record<string, string>; ok: boolean };

// Numeric semver-ish compare; plain string sort breaks at x.10.0.
export function compareVersions(a: string, b: string): number {
	const parse = (v: string) =>
		v
			.split(/[+-]/)[0]
			.split(".")
			.map((n) => Number.parseInt(n, 10) || 0);
	const [pa, pb] = [parse(a), parse(b)];
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return a.localeCompare(b);
}

async function fetchJson(url: string) {
	const res = await proxiedFetch(url);
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	return res.json();
}

// github.com artifact URLs imply the source repository; explicit
// metadata.repository wins when present.
export function deriveRepository(mod: VaultModule): string | null {
	const explicit = mod.meta?.repository;
	if (explicit?.startsWith("https://")) return explicit;
	const artifact = mod.artifacts[0];
	const gh = artifact?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\//);
	return gh ? `https://github.com/${gh[1]}` : null;
}

export async function loadCatalog(): Promise<Catalog> {
	const out: VaultModule[] = [];
	const revoked: Record<string, string> = {};
	const vault = DEFAULT_VAULT_URL();
	try {
		const data = await fetchJson(vault);
		for (const [id, reason] of Object.entries<string>(data.revoked ?? {})) {
			revoked[id] = reason;
		}
		for (const [id, mod] of Object.entries<any>(data.modules ?? {})) {
			const versions = Object.keys(mod.v ?? {}).sort(compareVersions);
			const version = mod.enabled ?? versions[versions.length - 1];
			const entry = mod.v?.[version];
			if (!entry) continue;
			if (!entry.artifacts?.length && !entry.files) continue;
			out.push({
				id,
				version,
				artifacts: entry.artifacts ?? [],
				files: entry.files,
				checksum: entry.checksum,
				vault,
				updatedAt: entry.updatedAt,
				hidden: entry.hidden,
				// Card data lives at the module level: one identity per
				// module, not one per release.
				meta: mod.metadata,
			});
		}
	} catch (e) {
		// An unreachable vault must not latch an empty catalog over a good
		// one, which is what ok distinguishes.
		console.warn("[store] vault failed", vault, e);
		return { modules: [], revoked: {}, ok: false };
	}
	return { modules: out, revoked, ok: true };
}

export function searchHaystack(mod: VaultModule): string {
	return [
		mod.id,
		mod.meta?.name ?? "",
		mod.meta?.description ?? "",
		...(mod.meta?.authors ?? []).map((a) => a.name),
		...(mod.meta?.tags ?? []),
	]
		.join(" ")
		.toLowerCase();
}

export const displayName = (mod: VaultModule) => mod.meta?.name ?? mod.id;

// A module's single category badge on cards, derived from its tags.
// The full tag list stays in the details dialog and in search.
const CATEGORY_TAGS = ["extension", "theme", "snippet", "app"];
export const categoryOf = (tags: string[] | undefined) => CATEGORY_TAGS.find((tag) => (tags ?? []).includes(tag));

// Vault version keys carry a "+cm-<classmap>-<hash>" build-metadata suffix
// identifying which classmap the artifact was stitched against. That is an
// internal packaging detail, so strip it for anything a user reads; the full
// key is still used for install, checksum, and count calls.
export const displayVersion = (version: string) => version.split("+")[0];
