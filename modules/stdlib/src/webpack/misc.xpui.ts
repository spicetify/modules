/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exportedFunctions, exports } from "./index.ts";
import { findBy } from "/hooks/util.ts";

await CHUNKS.xpui.promise;

export const Color: Function & {
	Format: any;
} = Object.assign(findBy("this.rgb")(exportedFunctions)!, {
	Format: exports.find((m) => m.RGBA)!,
});

export const Locale: any = exports.find((m) => m.getTranslations);

export const createUrlLocale: Function = findBy("has", "baseName", "language")(exportedFunctions);

export const InternalPropetyMap: any = exports.find((o) => o.Builder);
