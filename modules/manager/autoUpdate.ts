/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the daemon reports about itself. Either field is null when the daemon
// predates it.
export type DaemonInfo = { version: string | null; autoUpdate: boolean | null };

// The automatic-update surface of the wrapper's daemon API. Absent on a
// client patched before it existed.
export type AutoUpdateApi = {
	daemonInfo?(): Promise<DaemonInfo | null>;
	setAutoUpdate?(on: boolean): Promise<unknown>;
};

// Semver precedence: numeric fields, then a prerelease sorts below its
// release, and prerelease identifiers compare numerically when both are
// numbers (beta.10 above beta.9). Build metadata is ignored.
export function compareCliVersions(a: string, b: string): number {
	const parse = (v: string) => {
		const [core = "", pre] = v.split("+")[0]!.split(/-(.*)/s);
		return { core: core.split(".").map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split(".") : [] };
	};
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < 3; i++) {
		const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
		if (d !== 0) return d;
	}
	if (!pa.pre.length || !pb.pre.length) return pb.pre.length - pa.pre.length;
	for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
		const x = pa.pre[i];
		const y = pb.pre[i];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		const nx = /^\d+$/.test(x) ? Number(x) : null;
		const ny = /^\d+$/.test(y) ? Number(y) : null;
		if (nx !== null && ny !== null) {
			if (nx !== ny) return nx - ny;
		} else if (nx !== null || ny !== null) {
			return nx !== null ? -1 : 1;
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

// The Spicetify version installed since this client was last applied, which
// only reaches Spotify on the next apply. Null when there is nothing newer or
// either version is unknown.
export function pendingCliUpdate(info: DaemonInfo | null, appliedVersion: string | undefined): string | null {
	const installed = info?.version;
	if (!installed || !appliedVersion) return null;
	return compareCliVersions(installed, appliedVersion) > 0 ? installed : null;
}
