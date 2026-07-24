/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleInstance } from "/hooks/module.ts";

// warn logs to the console and, when the loader's diagnostics buffer exists,
// records the entry so management UIs can surface drift without the
// devtools console. stdlib never creates the buffer — the loader owns it.
export const warn = (...args: unknown[]): void => {
	console.warn(...args);
	const buffer = (globalThis as never as {
		__SPICETIFY_DIAGNOSTICS__?: Array<{ ts: number; level: string; message: string }>;
	}).__SPICETIFY_DIAGNOSTICS__;
	buffer?.push({ ts: Date.now(), level: "warn", message: args.map(String).join(" ") });
};

export const createLogger = (mod: ModuleInstance) => {
	const hookedMethods = new Set(["debug", "error", "info", "log", "warn"]);

	return new Proxy(globalThis.console, {
		get(target, p, receiver) {
			const func: unknown = Reflect.get(target, p, receiver);

			if (typeof p === "string" && hookedMethods.has(p) && typeof func === "function") {
				// @ts-ignore
				return (...data: any[]) => func.call(target, `[${mod.getModuleIdentifier()}]:`, ...data);
			}

			return func;
		},
	});
};
