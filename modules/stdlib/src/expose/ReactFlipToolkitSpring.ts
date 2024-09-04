/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mixin.ts";

import type { spring } from "npm:react-flip-toolkit";

export type ReactFlipToolkitSpring = typeof spring;
export let ReactFlipToolkitSpring: ReactFlipToolkitSpring;

transformer<ReactFlipToolkitSpring>(
	(emit) => (str) => {
		str = str.replace(
			/([a-zA-Z_\$][\w\$]*)=((?:function|\()([\w$.,{}()= ]+(?:springConfig|overshootClamping)){2})/,
			"$1=__ReactFlipToolkitSpring=$2",
		);
		Object.defineProperty(globalThis, "__ReactFlipToolkitSpring", { set: emit });
		return str;
	},
	{
		glob: /^\/vendor~xpui\.js/,
	},
).then(($) => {
	ReactFlipToolkitSpring = $;
});
