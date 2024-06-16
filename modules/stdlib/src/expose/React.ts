/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mixin.ts";

import type ReactT from "npm:@types/react";

export type React = typeof ReactT;
export let React: React;

transformer(
	emit => str => {
		str = str.replace(/([a-zA-Z_\$][\w\$]*\.prototype\.setState=)/, "__React=t;$1");
		Object.defineProperty(globalThis, "__React", {
			set: emit,
		});
		return str;
	},
	{
		then: ($: React) => {
			React = $;
		},
		glob: /^\/vendor~xpui\.js/,
	},
);
