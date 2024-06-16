/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { chunks, require } from "./index.ts";

import type classNamesT from "npm:@types/classnames";
export type classNames = typeof classNamesT;

export let classnames: classNames;

CHUNKS.xpui.promise.then(() => {
	classnames = chunks
		.filter(([_, v]) => v.toString().includes("[native code]"))
		.map(([i]) => require(i))
		.find((e) => typeof e === "function");
});
