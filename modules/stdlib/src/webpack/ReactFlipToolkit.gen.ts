/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as ReactFlipToolkit_xpui_ts from "./ReactFlipToolkit.xpui.ts";
export let Flipper: typeof ReactFlipToolkit_xpui_ts.Flipper;
export let Flipped: typeof ReactFlipToolkit_xpui_ts.Flipped;
import("./ReactFlipToolkit.xpui.ts").then(m => {
	Flipper = m.Flipper;
	Flipped = m.Flipped;
});
