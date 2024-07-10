/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mix.ts";

import type { PlatformAutoGen } from "/hooks/PlatformAutoGen.d.ts";

export type Platform = PlatformAutoGen;
export let Platform: Platform;
export let Cosmos: ReturnType<Platform["getPlayerAPI"]>["_cosmos"];

transformer<Platform>(
	emit => str => {
		str = str.replace(
			/(setTitlebarHeight[\w(){}.,&$!=;"" ]+)(\{version:[a-zA-Z_\$][\w\$]*,)/,
			"$1__Platform=$2",
		);
		Object.defineProperty(globalThis, "__Platform", {
			set: emit,
		});
		return str;
	},
	{
		then: ($: Platform) => {
			Platform = $;
			Cosmos = $.getRegistry()._map.get(Symbol.for("Cosmos")).instance;
		},
		glob: /^\/xpui\.js/,
	},
);
