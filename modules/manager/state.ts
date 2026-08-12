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
	classmapSpotify?: string;
	classmapVerified?: boolean;
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
		Platform?: { version?: string };
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
	classmapSpotify?: string;
	classmapVerified?: boolean;
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

	// The desktop client's fourth build component does not affect classmap
	// compatibility. Keep every Manager surface on the three-part line.
	return {
		spotifyVersion: spotifyVersionLine(g.Spicetify?.Platform?.version ?? manifest?.spotifyVersion),
		classmapKey: manifest?.classmapKey,
		cliVersion: manifest?.cliVersion,
		updatesBlocked: manifest?.updatesBlocked,
		classmapSpotify: spotifyVersionLine(manifest?.classmapSpotify),
		classmapVerified: manifest?.classmapVerified,
		supportedSpotify: spotifyVersionLine(manifest?.supportedSpotify),
		latestSpotify: spotifyVersionLine(manifest?.latestSpotify),
		classmapFallback: manifest?.classmapFallback,
		transformsEnabled: g.__SPICETIFY_APPLY_TRANSFORMS__ === true,
		modules,
		loadedCount: modules.filter((m) => m.loaded).length,
		failedCount: modules.filter((m) => m.failed !== undefined).length,
		diagnostics: [...(g.__SPICETIFY_DIAGNOSTICS__ ?? [])].reverse(),
	};
}

// Some loader calls do less than their name suggests and say so in what they
// resolve. removeLocal is the one that matters: when a CLI-staged copy sits
// behind the record it deletes, the loader reverts to that copy and the module
// keeps running, so reporting a bare "remove done" is a lie.
export function describeAction(label: string, outcome: unknown): string {
	const result = outcome as { revertedTo?: string; requiresRestart?: boolean } | null | undefined;
	if (result?.revertedTo) return `${label}: reverted to the CLI-installed ${result.revertedTo}`;
	if (result?.requiresRestart) return `${label} done — restart Spotify to finish`;
	return `${label} done`;
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
	installedSupported?: boolean;
	updatedAt?: string;
}

export interface SpotifyAvailabilityStatus {
	latestSpotify?: string;
	updatedAt?: string;
}

const SUPPORT_URL = () =>
	globalThis.localStorage?.getItem("spicetify:supportUrl") ??
	"https://raw.githubusercontent.com/spicetify/modules/main/spotify-support.json";

let supportCache: SpotifyAvailabilityStatus | undefined;

// Successful responses are cached for the session; failures are not, so a
// transient 404 or offline boot does not lock "unknown" until restart.
export async function fetchSupportStatus(): Promise<SpotifyAvailabilityStatus | null> {
	if (supportCache !== undefined) return supportCache;
	try {
		const res = await fetch(SUPPORT_URL());
		if (!res.ok) return null;
		const body = (await res.json()) as SpotifyAvailabilityStatus;
		supportCache = { latestSpotify: spotifyVersionLine(body.latestSpotify), updatedAt: body.updatedAt };
		return supportCache;
	} catch {
		return null;
	}
}

export function spotifyVersionLine(version: string | undefined): string | undefined {
	if (!version) return undefined;
	const parts = version.split(".").slice(0, 3);
	if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return undefined;
	return parts.map((part) => String(Number(part))).join(".");
}

// Classmap compatibility is major.minor.patch. Spotify's fourth desktop build
// component and git suffix are deliberately ignored everywhere.
export function compareSpotifyVersions(a: string, b: string): number {
	const parse = (v: string) =>
		v
			.split(".")
			.slice(0, 3)
			.map((part) => parseInt(part, 10))
			.filter((n) => !Number.isNaN(n));
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
		const d = pa[i]! - pb[i]!;
		if (d !== 0) return d;
	}
	return 0;
}

// Each field has one authoritative source:
//   installedSupported = whether the selected, index-verified classmap names
//     this exact installed build.
//   supported = the newest verified build in the cached classmaps index.
//   latest = the newest build observed by either the availability feed or the
//     verified classmaps index. Installed is also a hard lower bound because
//     either remote source can temporarily lag reality.
export function effectiveSupport(
	state: Pick<
		ManagerState,
		"spotifyVersion" | "classmapSpotify" | "classmapVerified" | "supportedSpotify" | "latestSpotify"
	>,
	feed: SpotifyAvailabilityStatus | null,
): SpotifySupportStatus | null {
	const spotifyVersion = spotifyVersionLine(state.spotifyVersion);
	const classmapSpotify = spotifyVersionLine(state.classmapSpotify);
	const supportedSpotify = spotifyVersionLine(state.supportedSpotify);
	const stateLatest = spotifyVersionLine(state.latestSpotify);
	const feedLatest = spotifyVersionLine(feed?.latestSpotify);
	const installedSupported =
		state.classmapVerified === false
			? false
			: state.classmapVerified === true
				? !!spotifyVersion && !!classmapSpotify && compareSpotifyVersions(spotifyVersion, classmapSpotify) === 0
				: undefined;
	const latestSpotify = [spotifyVersion, supportedSpotify, stateLatest, feedLatest]
		.filter((version): version is string => !!version)
		.reduce<string | undefined>(
			(latest, version) => (!latest || compareSpotifyVersions(version, latest) > 0 ? version : latest),
			undefined,
		);
	if (!supportedSpotify && !latestSpotify && installedSupported === undefined) return feed;
	return {
		supportedSpotify,
		latestSpotify,
		installedSupported,
		updatedAt: feed?.updatedAt,
	};
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
	const installedLine = spotifyVersionLine(installed);
	const supportedLine = spotifyVersionLine(support?.supportedSpotify);
	const latestLine = spotifyVersionLine(support?.latestSpotify);
	// Unsupported takes precedence. A selected verified classmap is definitive;
	// without that provenance, being newer than the newest verified index entry
	// is still enough to say the current build is unsupported.
	if (
		installedLine &&
		(support?.installedSupported === false ||
			(support?.installedSupported !== true &&
				supportedLine &&
				compareSpotifyVersions(installedLine, supportedLine) > 0))
	) {
		return {
			kind: "unsupported",
			message: `Spotify ${installedLine} isn't fully supported yet — some features may be off until Spicetify catches up`,
		};
	}
	if (!installedLine || !latestLine) {
		return { kind: "unknown", message: "Spotify update status unknown" };
	}
	if (compareSpotifyVersions(latestLine, installedLine) <= 0) {
		return { kind: "current", message: `Spotify is up to date (latest known: ${latestLine})` };
	}
	if (supportedLine && compareSpotifyVersions(supportedLine, latestLine) >= 0) {
		return {
			kind: "ready",
			message: `Spotify ${latestLine} is available and spicetify supports it — update via the CLI`,
		};
	}
	return {
		kind: "waiting",
		message: `Spotify ${latestLine} is available but held — waiting for spicetify support`,
	};
}
