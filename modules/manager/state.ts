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
			list?: () => Array<
				{ identifier: string; version: string; loaded: boolean; mixedIn: boolean; local?: boolean; failed?: string }
			>;
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
	const parse = (v: string) => v.split(".").map((part) => parseInt(part, 10)).filter((n) => !Number.isNaN(n));
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

// The published feed is the freshest source of truth; the CLI also snapshots
// the same versions onto the manifest at apply time, so those serve as an
// offline fallback when the live fetch fails or is still pending.
export function effectiveSupport(
	state: Pick<ManagerState, "supportedSpotify" | "latestSpotify">,
	feed: SpotifySupportStatus | null,
): SpotifySupportStatus | null {
	// All-or-nothing: never blend a fresh feed field with a stale manifest
	// field (a partial feed payload could pair a new `latest` with an old
	// `supported` and flip the advice). Use the live feed whenever it carries
	// any version; fall back to the manifest snapshot only when the feed is
	// entirely absent.
	if (feed?.latestSpotify || feed?.supportedSpotify) return feed;
	if (state.latestSpotify || state.supportedSpotify) {
		return { latestSpotify: state.latestSpotify, supportedSpotify: state.supportedSpotify };
	}
	return feed;
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
