/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exported, exportedFunctions } from "./index.ts";
import { findBy } from "../util.ts";

await CHUNKS.xpui.promise;

// The client's own color class; no static types exist for it.
export type Color = any;

export const Color: Function & {
	Format: any;
	[member: string]: any;
} = Object.assign(findBy("this.rgb")(exportedFunctions)!, {
	// Typed predicate: some client exports are get-trap proxies that answer
	// truthy for any key, so "has RGBA" alone can latch onto the wrong one.
	Format: exported.find((m) => typeof m?.RGBA === "number" && typeof m?.HEX === "number")!,
});

export const Locale: any = exported.find((m) => typeof m.getTranslations === "function");

export const createUrlLocale: Function = findBy("has", "baseName", "language")(exportedFunctions);

export const InternalPropetyMap: any = exported.find((o) => typeof o.Builder === "function");
