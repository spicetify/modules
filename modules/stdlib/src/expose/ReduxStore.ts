/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mix.ts";

import type { Store } from "npm:@types/redux";

export type ReduxStore = Store;
export let ReduxStore: ReduxStore;

transformer<ReduxStore>(
	emit => str => {
		str = str.replace(
			/(,[a-zA-Z_\$][\w\$]*=)(([$\w,.:=;(){}]+\(\{session:[a-zA-Z_\$][\w\$]*,features:[a-zA-Z_\$][\w\$]*,seoExperiment:[a-zA-Z_\$][\w\$]*\}))/,
			"$1__ReduxStore=$2",
		);
		Object.defineProperty(globalThis, "__ReduxStore", {
			set: emit,
		});
		return str;
	},
	{
		then: ($: ReduxStore) => {
			ReduxStore = $;
		},
		glob: /^\/xpui\.js/,
	},
);
