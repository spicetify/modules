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
import { CORS_PROXY } from "./runtime.ts";

const DEFAULT_VAULT_URL = () =>
	globalThis.localStorage?.getItem("spicetify:defaultVaultUrl") ??
	"https://raw.githubusercontent.com/spicetify/modules/main/vault.json";

// raw.githubusercontent and the vault hosts are CORS-enabled; github.com
// release downloads are not. Only proxy what needs it, with the raw URL
// substituted (both proxies reject encoded targets).
const needsProxy = (url: string) => url.startsWith("https://github.com/");

export const proxiedFetch = (url: string, init?: RequestInit): Promise<Response> => {
	if (!needsProxy(url)) return fetch(url, init);
	const proxy = CORS_PROXY()?.fetch;
	return proxy ? proxy(url, init) : fetch(url, init);
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
	// The vault pinned this version with `enabled` rather than it simply
	// being the highest. A pin is a maintainer's deliberate choice, which is
	// the one case where moving backwards is the right thing to offer.
	pinned?: boolean;
	meta?: {
		name?: string;
		description?: string;
		// Each author may carry their own GitHub username; the details
		// dialog links those names to their profiles.
		authors?: Array<{ name: string; github?: string }>;
		kind?: ModuleKind;
		/** Pre-`kind` vault entries; read through kindOf, never directly. */
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

// Semver precedence. Held identical to scripts/validate-submission.ts by a
// parity test: the registry decides what may be published with one copy and
// the store decides what to install with the other, so a divergence means
// the client resolves a different version than the one that was validated.
export function compareVersions(a: string, b: string): number {
	const split = (v: string) => {
		const [core, ...rest] = v.split("+")[0]!.split("-");
		return { core: core!, pre: rest.join("-") };
	};
	const [va, vb] = [split(a), split(b)];
	const nums = (core: string) => core.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const [na, nb] = [nums(va.core), nums(vb.core)];
	for (let i = 0; i < Math.max(na.length, nb.length); i++) {
		const d = (na[i] ?? 0) - (nb[i] ?? 0);
		if (d) return d;
	}
	if (!va.pre && !vb.pre) return buildTiebreak(a, b);
	// A missing prerelease is the release, which always wins.
	if (!va.pre) return 1;
	if (!vb.pre) return -1;
	const [pa, pb] = [va.pre.split("."), vb.pre.split(".")];
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i];
		const y = pb[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const [nx, ny] = [Number.parseInt(x, 10), Number.parseInt(y, 10)];
		const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
		if (numeric) {
			if (nx !== ny) return nx - ny;
			continue;
		}
		// Numeric identifiers rank below alphanumeric ones.
		if (/^\d+$/.test(x)) return -1;
		if (/^\d+$/.test(y)) return 1;
		if (x !== y) return x < y ? -1 : 1;
	}
	return buildTiebreak(a, b);
}

/**
 * Build metadata (`+cm-<classmap>`) is not part of semver precedence, so two
 * keys that differ only there are equal by the spec. They still have to order
 * deterministically: the store picks a version by sorting keys and taking the
 * last, and an arbitrary tie would make that pick vary run to run.
 */
function buildTiebreak(a: string, b: string): number {
	const meta = (v: string) => v.split("+")[1] ?? "";
	const [ma, mb] = [meta(a), meta(b)];
	if (ma === mb) return 0;
	return ma < mb ? -1 : 1;
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
			const pinned = typeof mod.enabled === "string" && !!mod.enabled;
			const version = pinned ? mod.enabled : versions[versions.length - 1];
			const entry = mod.v?.[version];
			if (!entry) continue;
			if (!entry.artifacts?.length && !entry.files) continue;
			out.push({
				id,
				version,
				pinned,
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
		kindOf(mod.meta),
	]
		.join(" ")
		.toLowerCase();
}

export const displayName = (mod: VaultModule) => mod.meta?.name ?? mod.id;

// What a module is. One value, not a list of adjectives: it drives the
// toolbar tabs and the single-theme rules, and nothing else needed saying.
export type ModuleKind = "extension" | "theme" | "snippet" | "app" | "lib";
const KINDS: ModuleKind[] = ["extension", "theme", "snippet", "app", "lib"];

// Falls back to the pre-`kind` tag list so entries from an older vault (or a
// record installed from one) still categorise. Unknown means extension, which
// is inert: it never joins the single-theme contest.
export const kindOf = (meta: { kind?: string; tags?: string[] } | undefined): ModuleKind => {
	if (meta?.kind && (KINDS as string[]).includes(meta.kind)) return meta.kind as ModuleKind;
	return KINDS.find((kind) => meta?.tags?.includes(kind)) ?? "extension";
};

// Vault version keys carry a "+cm-<classmap>-<hash>" build-metadata suffix
// identifying which classmap the artifact was stitched against. That is an
// internal packaging detail, so strip it for anything a user reads; the full
// key is still used for install, checksum, and count calls.
export const displayVersion = (version: string) => version.split("+")[0];
