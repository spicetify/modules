/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { analyzeWebpackRequire, src } from "./index.ts";
import { webpackRequire } from "../wpunpk.mix.ts";

await (CHUNKS["/dwp-panel-section.js"] ??= Promise.withResolvers()).promise;

const { exportedFunctions, exportedForwardRefs } = analyzeWebpackRequire(webpackRequire);

export const PanelContainer: React.FC<any> = exportedFunctions.find((f) =>
	src(f).includes('"Desktop_PanelContainer_Id"'),
);

export const PanelContent: React.FC<any> = exportedForwardRefs.find((f) => src(f.render).includes("fixedHeader"));

export const PanelHeader: React.FC<any> = exportedFunctions.find((m) => src(m).includes("PanelHeader_CloseButton"))!;
