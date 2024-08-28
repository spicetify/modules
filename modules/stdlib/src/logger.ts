/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleInstance } from "/hooks/module.ts";

export const createLogger = (mod: ModuleInstance) => {
	const hookedMethods = new Set(["debug", "error", "info", "log", "warn"]);

	return new Proxy(globalThis.console, {
		get(target, p, receiver) {
			const func = Reflect.get(target, p, receiver);

			if (typeof p === "string" && hookedMethods.has(p)) {
				// @ts-ignore
				return (...data: any[]) => func(`[${mod.getModuleIdentifier()}]:`, ...data);
			}

			return func;
		},
	});
};