/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as FilterContext_xpui_ts from "./FilterContext.xpui.ts";
export let FilterContext: typeof FilterContext_xpui_ts.FilterContext;
import("./FilterContext.xpui.ts").then(m => {
	FilterContext = m.FilterContext;
}).catch((e) => console.warn("[stdlib] lazy webpack surface ./FilterContext.xpui.ts failed:", e));
