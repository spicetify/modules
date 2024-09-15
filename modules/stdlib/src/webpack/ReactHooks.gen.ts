/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as ReactHooks_fullscreen_ts from "./ReactHooks.fullscreen.ts";
export let useExtractedColor: typeof ReactHooks_fullscreen_ts.useExtractedColor;
import("./ReactHooks.fullscreen.ts").then(m => {
	useExtractedColor = m.useExtractedColor;
});

import type * as ReactHooks_xpui_ts from "./ReactHooks.xpui.ts";
export let DragHandler: typeof ReactHooks_xpui_ts.DragHandler;
export let usePanelAPI: typeof ReactHooks_xpui_ts.usePanelAPI;
export let useContextMenuState: typeof ReactHooks_xpui_ts.useContextMenuState;
export let imageAnalysis: typeof ReactHooks_xpui_ts.imageAnalysis;
export let fallbackPreset: typeof ReactHooks_xpui_ts.fallbackPreset;
export let getPlayContext: typeof ReactHooks_xpui_ts.getPlayContext;
export let useTrackListColumns: typeof ReactHooks_xpui_ts.useTrackListColumns;
export let usePanelStateMachine: typeof ReactHooks_xpui_ts.usePanelStateMachine;
export let extractColorPreset: typeof ReactHooks_xpui_ts.extractColorPreset;
import("./ReactHooks.xpui.ts").then(m => {
	DragHandler = m.DragHandler;
	usePanelAPI = m.usePanelAPI;
	useContextMenuState = m.useContextMenuState;
	imageAnalysis = m.imageAnalysis;
	fallbackPreset = m.fallbackPreset;
	getPlayContext = m.getPlayContext;
	useTrackListColumns = m.useTrackListColumns;
	usePanelStateMachine = m.usePanelStateMachine;
	extractColorPreset = m.extractColorPreset;
});
