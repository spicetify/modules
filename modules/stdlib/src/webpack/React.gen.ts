/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as React_xpui_ts from "./React.xpui.ts";
export let ReactJSX: typeof React_xpui_ts.ReactJSX;
export let ReactDOM: typeof React_xpui_ts.ReactDOM;
export let ReactDOMServer: typeof React_xpui_ts.ReactDOMServer;
import("./React.xpui.ts").then(m => {
	ReactJSX = m.ReactJSX;
	ReactDOM = m.ReactDOM;
	ReactDOMServer = m.ReactDOMServer;
});
