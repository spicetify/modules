/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The pure core of loopy-loop: marker clamping, stored-state parsing, skip-zone
// lookup and the prev-press thresholds, hoisted from the module closure so they
// run under node --test. The timing/seek state machine stays in mod.tsx with
// the Player access it drives.

export type SkipZone = { start: number; end: number };

// Markers live in 0..1 track fractions; the 1e-6 epsilon keeps start strictly
// before end so enforcement never oscillates on a zero-width loop.
export const EPSILON = 1e-6;

export function moveStart(start: number, end: number | null, delta: number): number {
	return Math.max(0, Math.min(end !== null ? end - EPSILON : 1, start + delta));
}

export function moveEnd(end: number, start: number | null, delta: number): number {
	return Math.max(start !== null ? start + EPSILON : 0, Math.min(1, end + delta));
}

export function moveZoneEdge(zone: SkipZone, side: "start" | "end", delta: number): SkipZone {
	if (side === "start") {
		return { ...zone, start: Math.max(0, Math.min(zone.end - EPSILON, zone.start + delta)) };
	}
	return { ...zone, end: Math.max(zone.start + EPSILON, Math.min(1, zone.end + delta)) };
}

export function parseStoredState(raw: string | null): {
	start: number | null;
	end: number | null;
	skipZones: SkipZone[];
} {
	const empty = { start: null, end: null, skipZones: [] };
	if (!raw) return empty;
	try {
		const data = JSON.parse(raw);
		return {
			start: data.start ?? null,
			end: data.end ?? null,
			skipZones: Array.isArray(data.skipZones) ? data.skipZones : [],
		};
	} catch (_) {
		return empty;
	}
}

export function findActiveZone(skipZones: SkipZone[], percent: number): number {
	return skipZones.findIndex((zone) => percent >= zone.start && percent < zone.end);
}

// Fractions of the track that model Spotify's 3s "restart" threshold and the
// near-zero landing window, with fallbacks when the duration is unknown.
export function restartThresholds(durationMs: number): { threeSecFrac: number; nearZeroFrac: number } {
	return {
		threeSecFrac: durationMs > 0 ? 3000 / durationMs : 0.02,
		nearZeroFrac: durationMs > 0 ? 1500 / durationMs : 0.01,
	};
}
