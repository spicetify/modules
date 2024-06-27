/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mix.ts";

import type { spring } from "npm:react-flip-toolkit";

export type ReactFlipToolkitSpring = typeof spring;
export let ReactFlipToolkitSpring: ReactFlipToolkitSpring;

transformer(
	emit => str => {
		str = str.replace(
			/([a-zA-Z_\$][\w\$]*)=((?:function|\()([\w$.,{}()= ]+(?:springConfig|overshootClamping)){2})/,
			"$1=__ReactFlipToolkitSpring=$2",
		);
		Object.defineProperty(globalThis, "__ReactFlipToolkitSpring", { set: emit });
		return str;
	},
	{
		then: ($: ReactFlipToolkitSpring) => {
			ReactFlipToolkitSpring = $;
		},
		glob: /^\/vendor~xpui\.js/,
	},
);
