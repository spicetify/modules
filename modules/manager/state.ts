/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// One derivation for both manager surfaces. Pure and defensive: every
// loader-provided field can be absent (older CLI manifests, partial boots)
// and renders as "unknown" rather than a guess.

export interface ManagerModuleRow {
	id: string;
	version: string;
	source: "staged" | "local";
	loaded: boolean;
	mixedIn: boolean;
	failed?: string;
	dependencies: Record<string, string>;
}

export interface DiagnosticsEntry {
	ts: number;
	level: string;
	message: string;
}

export interface ManagerState {
	spotifyVersion?: string;
	classmapKey?: string;
	cliVersion?: string;
	updatesBlocked?: boolean;
	updatePolicy?: string;
	supportedSpotify?: string;
	latestSpotify?: string;
	classmapFallback?: boolean;
	transformsEnabled: boolean;
	modules: ManagerModuleRow[];
	loadedCount: number;
	failedCount: number;
	diagnostics: DiagnosticsEntry[];
}

type LoaderGlobals = {
	Spicetify?: {
		Modules?: {
			manifest?: Manifest;
			registry?: { manifest?: Manifest };
			report?: { loaded: string[]; failed: Record<string, string> };
			list?: () => Array<{
				identifier: string;
				version: string;
				loaded: boolean;
				mixedIn: boolean;
				local?: boolean;
				failed?: string;
			}>;
		};
	};
	__SPICETIFY_MODULAR_MANIFEST__?: Manifest;
	__SPICETIFY_APPLY_TRANSFORMS__?: unknown;
	__SPICETIFY_DIAGNOSTICS__?: DiagnosticsEntry[];
};

type Manifest = {
	spotifyVersion?: string;
	classmapKey?: string;
	cliVersion?: string;
	updatesBlocked?: boolean;
	updatePolicy?: string;
	supportedSpotify?: string;
	latestSpotify?: string;
	classmapFallback?: boolean;
	modules?: Array<{ identifier: string; version: string; dependencies?: Record<string, string> }>;
};

export function deriveManagerState(): ManagerState {
	const g = globalThis as never as LoaderGlobals;
	const M = g.Spicetify?.Modules;
	const manifest = M?.manifest ?? M?.registry?.manifest ?? g.__SPICETIFY_MODULAR_MANIFEST__;

	// list() is registry truth: it covers staged modules, live local
	// installs, and removals, and its `local` flag marks records actually
	// loaded from localStorage (not stale shadowed copies).
	const manifestById = new Map((manifest?.modules ?? []).map((m) => [m.identifier, m]));
	const modules: ManagerModuleRow[] = (M?.list?.() ?? []).map((s) => ({
		id: s.identifier,
		version: s.version,
		source: s.local ? "local" : "staged",
		loaded: s.loaded,
		mixedIn: s.mixedIn,
		failed: s.failed,
		dependencies: manifestById.get(s.identifier)?.dependencies ?? {},
	}));

	return {
		spotifyVersion: manifest?.spotifyVersion,
		classmapKey: manifest?.classmapKey,
		cliVersion: manifest?.cliVersion,
		updatesBlocked: manifest?.updatesBlocked,
		updatePolicy: manifest?.updatePolicy,
		supportedSpotify: manifest?.supportedSpotify,
		latestSpotify: manifest?.latestSpotify,
		classmapFallback: manifest?.classmapFallback,
		transformsEnabled: g.__SPICETIFY_APPLY_TRANSFORMS__ === true,
		modules,
		loadedCount: modules.filter((m) => m.loaded).length,
		failedCount: modules.filter((m) => m.failed !== undefined).length,
		diagnostics: [...(g.__SPICETIFY_DIAGNOSTICS__ ?? [])].reverse(),
	};
}

export const show = (value: string | undefined): string => value ?? "unknown";

export const showBool = (value: boolean | undefined): string =>
	value === undefined ? "unknown" : value ? "yes" : "no";

// "Is a Spotify update waiting on spicetify?" — the client's own updater is
// blind while updates are blocked, so the answer comes from a support feed
// published with the classmap releases.
export interface SpotifySupportStatus {
	latestSpotify?: string;
	supportedSpotify?: string;
	updatedAt?: string;
}

const SUPPORT_URL = () =>
	globalThis.localStorage?.getItem("spicetify:supportUrl") ??
	"https://raw.githubusercontent.com/spicetify/modules/main/spotify-support.json";

let supportCache: SpotifySupportStatus | undefined;

// Successful responses are cached for the session; failures are not, so a
// transient 404 or offline boot does not lock "unknown" until restart.
export async function fetchSupportStatus(): Promise<SpotifySupportStatus | null> {
	if (supportCache !== undefined) return supportCache;
	try {
		const res = await fetch(SUPPORT_URL());
		if (!res.ok) return null;
		supportCache = (await res.json()) as SpotifySupportStatus;
		return supportCache;
	} catch {
		return null;
	}
}

// Numeric dotted-prefix compare ("1.2.95.120" vs "1.2.94.583.g..."): git
// suffixes and missing segments are ignored.
export function compareSpotifyVersions(a: string, b: string): number {
	const parse = (v: string) =>
		v
			.split(".")
			.map((part) => parseInt(part, 10))
			.filter((n) => !Number.isNaN(n));
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

// Each field has one authoritative source, so they are never blended
// incorrectly:
//   supported = what THIS install can actually apply. The CLI derives it from
//     the local classmaps and stamps it on the manifest, so the manifest is
//     authoritative; the feed is only a fallback for an older CLI that did not
//     stamp it.
//   latest = the newest build that exists, which only the live feed knows;
//     the manifest snapshot is the offline fallback.
export function effectiveSupport(
	state: Pick<ManagerState, "supportedSpotify" | "latestSpotify">,
	feed: SpotifySupportStatus | null,
): SpotifySupportStatus | null {
	const supportedSpotify = state.supportedSpotify ?? feed?.supportedSpotify;
	const latestSpotify = feed?.latestSpotify ?? state.latestSpotify;
	if (!supportedSpotify && !latestSpotify) return feed;
	return { supportedSpotify, latestSpotify, updatedAt: feed?.updatedAt };
}

// "Is the staged set behind the vault?" — a stale staged module keeps
// running an old build forever, silently: published fixes reach the vault
// but never an already-applied client. (The capture-freeze incident ran on a
// staged stdlib several releases behind the vault, and nothing said so.)

// Extracts { id -> newest published version } from a vault document
// (shape: { modules: { [id]: { v: { "1.0.0": {...}, ... } } } }). Pure and
// defensive: malformed entries are skipped, never thrown on.
export function latestPublishedVersions(vault: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	const mods = (vault as { modules?: Record<string, { v?: Record<string, unknown> }> })?.modules;
	if (!mods || typeof mods !== "object") return out;
	for (const [id, entry] of Object.entries(mods)) {
		const versions = Object.keys(entry?.v ?? {});
		if (!versions.length) continue;
		out[id] = versions.reduce((best, v) => (compareSpotifyVersions(v, best) > 0 ? v : best));
	}
	return out;
}

export interface StaleStagedRow {
	id: string;
	staged: string;
	published: string;
}

// Staged modules whose vault entry is strictly newer. Local installs are
// excluded on purpose: the store's own update flow owns those, while a stale
// staged copy has no surface at all except this one.
export function deriveStaleStaged(modules: ManagerModuleRow[], published: Record<string, string>): StaleStagedRow[] {
	return modules
		.filter((m) => m.source === "staged")
		.flatMap((m) => {
			const latest = published[m.id];
			return latest && compareSpotifyVersions(latest, m.version) > 0
				? [{ id: m.id, staged: m.version, published: latest }]
				: [];
		});
}

const VAULT_URL = () =>
	globalThis.localStorage?.getItem("spicetify:defaultVaultUrl") ??
	"https://raw.githubusercontent.com/spicetify/modules/main/vault.json";

let publishedCache: Record<string, string> | undefined;

// Same contract as fetchSupportStatus: successes cache for the session,
// failures do not, so a transient 404 or offline boot retries next mount.
export async function fetchPublishedVersions(): Promise<Record<string, string> | null> {
	if (publishedCache !== undefined) return publishedCache;
	try {
		const res = await fetch(VAULT_URL());
		if (!res.ok) return null;
		publishedCache = latestPublishedVersions(await res.json());
		return publishedCache;
	} catch {
		return null;
	}
}

export type UpdateAdvice =
	| { kind: "unknown"; message: string }
	| { kind: "current"; message: string }
	| { kind: "waiting"; message: string }
	| { kind: "ready"; message: string }
	| { kind: "unsupported"; message: string };

export function updateAdvice(installed: string | undefined, support: SpotifySupportStatus | null): UpdateAdvice {
	// Unsupported takes precedence: running a build newer than the newest
	// verified one means chrome may already be degraded. Only assert it when
	// supportedSpotify is actually known, so a failed feed fetch never raises
	// a false alarm. Assumes the feed publishes full version strings
	// (compareSpotifyVersions zero-pads missing segments, so a line-level
	// "1.2.94" would read every patch on that line as unsupported).
	if (installed && support?.supportedSpotify && compareSpotifyVersions(installed, support.supportedSpotify) > 0) {
		return {
			kind: "unsupported",
			message: `Spotify ${installed} isn't fully supported yet — some features may be off until Spicetify catches up`,
		};
	}
	if (!installed || !support?.latestSpotify) {
		return { kind: "unknown", message: "Spotify update status unknown" };
	}
	if (compareSpotifyVersions(support.latestSpotify, installed) <= 0) {
		return { kind: "current", message: `Spotify is up to date (latest known: ${support.latestSpotify})` };
	}
	if (support.supportedSpotify && compareSpotifyVersions(support.supportedSpotify, support.latestSpotify) >= 0) {
		return {
			kind: "ready",
			message: `Spotify ${support.latestSpotify} is available and spicetify supports it — update via the CLI`,
		};
	}
	return {
		kind: "waiting",
		message: `Spotify ${support.latestSpotify} is available but held — waiting for spicetify support`,
	};
}
