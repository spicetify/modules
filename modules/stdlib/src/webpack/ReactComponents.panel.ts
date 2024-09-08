/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { analyzeWebpackRequire } from "./index.ts";
import { webpackRequire } from "../wpunpk.mix.ts";

await (CHUNKS["/dwp-panel-section.js"] ??= Promise.withResolvers()).promise;

const { exportedFunctions, exportedForwardRefs } = analyzeWebpackRequire(webpackRequire);

export const PanelContainer: React.FC<any> = exportedFunctions.find((f) =>
	f.toString().includes('"Desktop_PanelContainer_Id"')
);

export const PanelContent: React.FC<any> = exportedForwardRefs.find((f) =>
	f.render.toString().includes("fixedHeader")
);

export const PanelHeader: React.FC<any> = exportedFunctions.find((m) =>
	m.toString().includes("PanelHeader_CloseButton")
)!;
