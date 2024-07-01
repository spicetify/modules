/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as Snackbar_xpui_ts from "./Snackbar.xpui.ts";
export let useSnackbar: typeof Snackbar_xpui_ts.useSnackbar;
export let enqueueCustomSnackbar: typeof Snackbar_xpui_ts.enqueueCustomSnackbar;
import("./Snackbar.xpui.ts").then(m => {
	useSnackbar = m.useSnackbar;
	enqueueCustomSnackbar = m.enqueueCustomSnackbar;
});
