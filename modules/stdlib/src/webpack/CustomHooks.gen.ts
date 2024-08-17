/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as CustomHooks_xpui_ts from "./CustomHooks.xpui.ts";
export let DragHandler: typeof CustomHooks_xpui_ts.DragHandler;
export let useExtractedColor: typeof CustomHooks_xpui_ts.useExtractedColor;
export let usePanelAPI: typeof CustomHooks_xpui_ts.usePanelAPI;
export let useContextMenuState: typeof CustomHooks_xpui_ts.useContextMenuState;
export let imageAnalysis: typeof CustomHooks_xpui_ts.imageAnalysis;
export let fallbackPreset: typeof CustomHooks_xpui_ts.fallbackPreset;
export let getPlayContext: typeof CustomHooks_xpui_ts.getPlayContext;
export let useTrackListColumns: typeof CustomHooks_xpui_ts.useTrackListColumns;
export let usePanelStateMachine: typeof CustomHooks_xpui_ts.usePanelStateMachine;
export let extractColorPreset: typeof CustomHooks_xpui_ts.extractColorPreset;
import("./CustomHooks.xpui.ts").then(m => {
	DragHandler = m.DragHandler;
	useExtractedColor = m.useExtractedColor;
	usePanelAPI = m.usePanelAPI;
	useContextMenuState = m.useContextMenuState;
	imageAnalysis = m.imageAnalysis;
	fallbackPreset = m.fallbackPreset;
	getPlayContext = m.getPlayContext;
	useTrackListColumns = m.useTrackListColumns;
	usePanelStateMachine = m.usePanelStateMachine;
	extractColorPreset = m.extractColorPreset;
});
