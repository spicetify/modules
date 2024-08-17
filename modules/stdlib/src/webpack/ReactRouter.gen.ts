/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as ReactRouter_xpui_ts from "./ReactRouter.xpui.ts";
export let useMatch: typeof ReactRouter_xpui_ts.useMatch;
export let useLocation: typeof ReactRouter_xpui_ts.useLocation;
import("./ReactRouter.xpui.ts").then(m => {
	useMatch = m.useMatch;
	useLocation = m.useLocation;
});
