/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { modules } from "./index.ts";
import { webpackRequire } from "../wpunpk.mix.ts";

type classNames = (...args: any[]) => string;

await globalThis.CHUNKS.xpui.promise;

export const classnames: classNames = modules
	.filter(([_, v]) => v.toString().includes("[native code]"))
	.map(([i]) => webpackRequire(i))
	.find((e) => typeof e === "function");
