/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mixin.ts";

type TippyT = any;

export type Tippy = TippyT;
export let Tippy: Tippy;

transformer<Tippy>(
	(emit) => (str) => {
		str = str.replace(/(([a-zA-Z_\$][\w\$]*)\.setDefaultProps=)/, "__Tippy=$2;$1");
		Object.defineProperty(globalThis, "__Tippy", {
			set: emit,
		});
		return str;
	},
	{
		glob: /^\/vendor~xpui\.js/,
	},
).then(($) => {
	Tippy = $;
});
