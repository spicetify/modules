/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mix.ts";

import type SnackbarT from "npm:notistack";

export type Snackbar = typeof SnackbarT;
export let Snackbar: Snackbar;

transformer<Snackbar>(
	(emit) => (str) => {
		str = str.replace(
			/var ([a-zA-Z_\$][\w\$]*);return\(\1=([^;]*?)\)\.enqueueSnackbar=/,
			"var $1;return($1=__Snackbar=$2).enqueueSnackbar=",
		);
		let __Snackbar: Snackbar | undefined = undefined;
		Object.defineProperty(globalThis, "__Snackbar", {
			set: (value) => {
				emit(value);
				__Snackbar = value;
			},
			get: () => __Snackbar,
		});
		return str;
	},
	{
		glob: /^\/vendor~xpui\.js/,
	},
).then(($) => {
	Snackbar = $;
});
