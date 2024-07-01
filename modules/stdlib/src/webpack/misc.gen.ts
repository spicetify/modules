/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as misc_xpui_ts from "./misc.xpui.ts";
export let Color: typeof misc_xpui_ts.Color;
export let Locale: typeof misc_xpui_ts.Locale;
export let createUrlLocale: typeof misc_xpui_ts.createUrlLocale;
export let InternalPropetyMap: typeof misc_xpui_ts.InternalPropetyMap;
import("./misc.xpui.ts").then(m => {
	Color = m.Color;
	Locale = m.Locale;
	createUrlLocale = m.createUrlLocale;
	InternalPropetyMap = m.InternalPropetyMap;
});
