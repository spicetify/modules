/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// warn logs to the console and, when the loader's diagnostics buffer exists,
// records the entry so management UIs can surface drift without the
// devtools console. stdlib never creates the buffer — the loader owns it.
const DIAGNOSTICS_CAP = 200;

const safeString = (value: unknown): string => {
	try {
		return String(value);
	} catch {
		return "[unprintable]";
	}
};

export const warn = (...args: unknown[]): void => {
	console.warn(...args);
	// Same cap the loader enforces; this is a public barrel export, so it
	// must neither grow the buffer unboundedly nor throw on hostile args.
	try {
		const buffer = (
			globalThis as never as {
				__SPICETIFY_DIAGNOSTICS__?: Array<{ ts: number; level: string; message: string }>;
			}
		).__SPICETIFY_DIAGNOSTICS__;
		if (!buffer) return;
		buffer.push({ ts: Date.now(), level: "warn", message: args.map(safeString).join(" ") });
		if (buffer.length > DIAGNOSTICS_CAP) buffer.splice(0, buffer.length - DIAGNOSTICS_CAP);
	} catch {
		// Never break the caller for a diagnostics write.
	}
};
