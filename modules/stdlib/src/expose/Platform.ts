/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mixin.ts";

import type { PlatformAutoGen } from "/hooks/PlatformAutoGen.d.ts";

export type Platform = PlatformAutoGen;
export let Platform: Platform;

transformer<Platform>(
	(emit) => (str) => {
		str = str.replace(
			/{(?=[^{}]*(?:{[^{}]*(?:{[^{}]*(?:{[^{}]*}[^{}]*)*}[^{}]*)*}[^{}]*)*(?<=[,{])version:)(?=[^{}]*(?:{[^{}]*(?:{[^{}]*(?:{[^{}]*}[^{}]*)*}[^{}]*)*}[^{}]*)*(?<=[,{])container:)/,
			"__Platform={",
		);
		Object.defineProperty(globalThis, "__Platform", {
			set: emit,
		});
		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
).then(($) => {
	Platform = $;
	const registry = $.getRegistry();
	for (const s of registry._map.keys()) {
		const getter = `get${s.description}`;
		if (Object.prototype.hasOwnProperty.call(Platform, getter)) {
			continue;
		}
		Object.defineProperty(Platform, getter, {
			get: () => () => registry.resolve(s),
		});
	}
});
