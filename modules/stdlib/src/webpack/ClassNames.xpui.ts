/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { modules, require } from "./index.ts";

import type classNames from "npm:@types/classnames";

await globalThis.CHUNKS.xpui.promise;

export const classnames: classNames = modules
	.filter(([_, v]) => v.toString().includes("[native code]"))
	.map(([i]) => require(i))
	.find((e) => typeof e === "function");
