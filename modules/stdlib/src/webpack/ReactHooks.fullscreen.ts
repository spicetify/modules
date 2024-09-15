/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { webpackRequire } from "../wpunpk.mix.ts";
import { analyzeWebpackRequire } from "./index.ts";

await (CHUNKS["/dwp-full-screen-mode-container.js"] ??= Promise.withResolvers()).promise;

const { exportedFunctions } = analyzeWebpackRequire(webpackRequire);

export const useExtractedColor: Function = exportedFunctions.find(
	(m) =>
		m.toString().includes("extracted-color") ||
		(m.toString().includes("colorRaw") && m.toString().includes("useEffect")),
)!;
