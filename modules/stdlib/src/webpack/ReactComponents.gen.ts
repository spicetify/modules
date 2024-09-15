/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as ReactComponents_desktop_ts from "./ReactComponents.desktop.ts";
export let Settings: typeof ReactComponents_desktop_ts.Settings;
import("./ReactComponents.desktop.ts").then(m => {
	Settings = m.Settings;
});

import type * as ReactComponents_panel_ts from "./ReactComponents.panel.ts";
export let PanelContainer: typeof ReactComponents_panel_ts.PanelContainer;
export let PanelContent: typeof ReactComponents_panel_ts.PanelContent;
export let PanelHeader: typeof ReactComponents_panel_ts.PanelHeader;
import("./ReactComponents.panel.ts").then(m => {
	PanelContainer = m.PanelContainer;
	PanelContent = m.PanelContent;
	PanelHeader = m.PanelHeader;
});

import type * as ReactComponents_xpui_ts from "./ReactComponents.xpui.ts";
export let Menus: typeof ReactComponents_xpui_ts.Menus;
export let Cards: typeof ReactComponents_xpui_ts.Cards;
export let RemoteConfigProviderComponent: typeof ReactComponents_xpui_ts.RemoteConfigProviderComponent;
export let Nav: typeof ReactComponents_xpui_ts.Nav;
export let NavTo: typeof ReactComponents_xpui_ts.NavTo;
export let InstrumentedRedirect: typeof ReactComponents_xpui_ts.InstrumentedRedirect;
export let SnackbarProvider: typeof ReactComponents_xpui_ts.SnackbarProvider;
export let ContextMenu: typeof ReactComponents_xpui_ts.ContextMenu;
export let RightClickMenu: typeof ReactComponents_xpui_ts.RightClickMenu;
export let Tooltip: typeof ReactComponents_xpui_ts.Tooltip;
export let Menu: typeof ReactComponents_xpui_ts.Menu;
export let MenuItem: typeof ReactComponents_xpui_ts.MenuItem;
export let MenuItemSubMenu: typeof ReactComponents_xpui_ts.MenuItemSubMenu;
export let RemoteConfigProvider: typeof ReactComponents_xpui_ts.RemoteConfigProvider;
export let Snackbar: typeof ReactComponents_xpui_ts.Snackbar;
export let FilterBox: typeof ReactComponents_xpui_ts.FilterBox;
export let ScrollableContainer: typeof ReactComponents_xpui_ts.ScrollableContainer;
export let ScrollableText: typeof ReactComponents_xpui_ts.ScrollableText;
export let Router: typeof ReactComponents_xpui_ts.Router;
export let Routes: typeof ReactComponents_xpui_ts.Routes;
export let Route: typeof ReactComponents_xpui_ts.Route;
export let StoreProvider: typeof ReactComponents_xpui_ts.StoreProvider;
export let GenericModal: typeof ReactComponents_xpui_ts.GenericModal;
export let Tracklist: typeof ReactComponents_xpui_ts.Tracklist;
export let TracklistColumnsContextProvider: typeof ReactComponents_xpui_ts.TracklistColumnsContextProvider;
import("./ReactComponents.xpui.ts").then(m => {
	Menus = m.Menus;
	Cards = m.Cards;
	RemoteConfigProviderComponent = m.RemoteConfigProviderComponent;
	Nav = m.Nav;
	NavTo = m.NavTo;
	InstrumentedRedirect = m.InstrumentedRedirect;
	SnackbarProvider = m.SnackbarProvider;
	ContextMenu = m.ContextMenu;
	RightClickMenu = m.RightClickMenu;
	Tooltip = m.Tooltip;
	Menu = m.Menu;
	MenuItem = m.MenuItem;
	MenuItemSubMenu = m.MenuItemSubMenu;
	RemoteConfigProvider = m.RemoteConfigProvider;
	Snackbar = m.Snackbar;
	FilterBox = m.FilterBox;
	ScrollableContainer = m.ScrollableContainer;
	ScrollableText = m.ScrollableText;
	Router = m.Router;
	Routes = m.Routes;
	Route = m.Route;
	StoreProvider = m.StoreProvider;
	GenericModal = m.GenericModal;
	Tracklist = m.Tracklist;
	TracklistColumnsContextProvider = m.TracklistColumnsContextProvider;
});
