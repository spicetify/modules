/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Platform } from "../expose/Platform.ts";
import { exported, exportedFunctions } from "./index.ts";
import { findBy } from "/hooks/util.ts";

await CHUNKS.xpui.promise;

export const DragHandler: Function = findBy("dataTransfer", "data-dragging")(exportedFunctions);

export const usePanelAPI: Function = findBy("panelSend", "context")(exportedFunctions);

export const useContextMenuState: Function = findBy("useContextMenuState")(exportedFunctions);

export const imageAnalysis: Function = findBy(/\![a-zA-Z_\$][\w\$]*\.isFallback|\{extractColor/)(
	exportedFunctions,
);

export const fallbackPreset: any = exported.find((m) => m.colorDark);

export const getPlayContext: Function = findBy("referrerIdentifier", "usePlayContextItem")(exportedFunctions);

export const useTrackListColumns: Function = findBy("useTrackListColumns")(exportedFunctions);

export const usePanelStateMachine: () => [state: any, actor: any, machine: any] = findBy(
	"usePanelStateMachine",
)(exportedFunctions);

export const extractColorPreset = async (image: any) => {
	const analysis = await imageAnalysis(Platform.getGraphQLLoader(), image);
	// for (const result of analysis) {
	// 	if (!("isFallback" in result)) {
	// 		result.isFallback = fallbackPreset === result;
	// 	}
	// }

	return analysis;
};
