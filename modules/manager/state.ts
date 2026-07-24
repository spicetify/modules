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
