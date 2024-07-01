/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as URI_xpui_ts from "./URI.xpui.ts";
export let Types: typeof URI_xpui_ts.Types;
export let is: typeof URI_xpui_ts.is;
export let create: typeof URI_xpui_ts.create;
export let isSameIdentity: typeof URI_xpui_ts.isSameIdentity;
export let urlEncode: typeof URI_xpui_ts.urlEncode;
export let idToHex: typeof URI_xpui_ts.idToHex;
export let hexToId: typeof URI_xpui_ts.hexToId;
export let from: typeof URI_xpui_ts.from;
export let fromString: typeof URI_xpui_ts.fromString;
import("./URI.xpui.ts").then(m => {
	Types = m.Types;
	is = m.is;
	create = m.create;
	isSameIdentity = m.isSameIdentity;
	urlEncode = m.urlEncode;
	idToHex = m.idToHex;
	hexToId = m.hexToId;
	from = m.from;
	fromString = m.fromString;
});
