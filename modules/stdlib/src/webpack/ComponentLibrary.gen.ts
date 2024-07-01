/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as ComponentLibrary_xpui_ts from "./ComponentLibrary.xpui.ts";
export let UI: typeof ComponentLibrary_xpui_ts.UI;
import("./ComponentLibrary.xpui.ts").then(m => {
	UI = m.UI;
});
