/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mixin.ts";

import type { Tippy as TippyT } from "npm:tippy.js";

export type Tippy = TippyT;
export let Tippy: Tippy;

transformer(
	emit => str => {
		str = str.replace(/(([a-zA-Z_\$][\w\$]*)\.setDefaultProps=)/, "__Tippy=$2;$1");
		Object.defineProperty(globalThis, "__Tippy", {
			set: emit,
		});
		return str;
	},
	{
		then: ($: Tippy) => {
			Tippy = $;
		},
		glob: /^\/vendor~xpui\.js/,
	},
);
