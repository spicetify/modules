/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mixin.ts";

import type { Store } from "npm:@types/redux";

export type ReduxStore = Store;
export let ReduxStore: ReduxStore;
export let Platform: any;

transformer(
	(emit) => (str) => {
		str = str.replace(
			/\.jsx\)\(([a-zA-Z_\$][\w\$]*),\{store:([a-zA-Z_\$][\w\$]*),platform:([a-zA-Z_\$][\w\$]*)\}\)/,
			".jsx)($1,{store:__ReduxStore=$2,platform:__Platform=$3})",
		);
		Object.defineProperty(globalThis, "__ReduxStore", {
			set: (value) => {
				emit();
				ReduxStore = value;
			},
			get: () => ReduxStore,
		});
		// Object.defineProperty(globalThis, "__Platform", {
		// 	set: (value) => {
		// 		emit();
		// 		Platform = value;
		// 	},
		// 	get: () => Platform,
		// });
		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);
