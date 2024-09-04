/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mixin.ts";

export let enqueueImageSnackbar: any;

// TODO: replace with a custom enqueueCustomSnackbar wrapper
transformer(
	(emit) => (str) => {
		str = str.replace(/(\(\({[^}]*,\s*imageSrc)/, "__enqueueImageSnackbar=$1");
		Object.defineProperty(globalThis, "__enqueueImageSnackbar", {
			set: emit,
		});
		return str;
	},
	{
		glob: /^\/xpui\.js/,
		wait: false,
	},
).then(($: any) => {
	enqueueImageSnackbar = $;
});
