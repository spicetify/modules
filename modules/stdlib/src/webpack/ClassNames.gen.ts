/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as ClassNames_xpui_ts from "./ClassNames.xpui.ts";
export let classnames: typeof ClassNames_xpui_ts.classnames;
import("./ClassNames.xpui.ts").then(m => {
	classnames = m.classnames;
});
