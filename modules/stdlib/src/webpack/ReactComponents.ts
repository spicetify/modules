/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { capitalize } from "../../deps.ts";
import { Platform } from "../expose/Platform.ts";
import {
	analyzeWebpackRequire,
	chunks,
	exportedForwardRefs,
	exportedFunctions,
	exportedMemos,
	modules,
	require,
} from "./index.ts";
import { findBy } from "/hooks/util.ts";
import { React } from "../expose/React.ts";

import type { SnackbarProvider as SnackbarProviderT } from "npm:notistack";
export type SnackbarProvider = SnackbarProviderT;

export let Menus: any;
export let Cards: any;
export let RemoteConfigProviderComponent: React.FC<any>;
export let Slider: React.FC<any>;
export let Nav: React.NamedExoticComponent;
export let NavTo: React.NamedExoticComponent;
export let InstrumentedRedirect: any;
export let SnackbarProvider: SnackbarProvider;
export let Settings: {
	SettingsLabel: React.FC<{}>;
	SettingsRow: React.FC<{}>;
	SettingsRowEnd: React.FC<{}>;
	SettingsRowStart: React.FC<{}>;
};
export let SettingsToggle: Function;

export let ContextMenu: any;
export let RightClickMenu: Function;

export let ConfirmDialog: Function;
export let Tooltip: Function;

export let Menu: Function;
export let MenuItem: Function;
export let MenuItemSubMenu: Function;

export let RemoteConfigProvider: ({
	configuration,
	children,
}: {
	configuration?:
		| {
			accessListeners: Set<any>;
			getValue: () => any;
			toBuilder: () => any;
			toJSON: () => any;
			values: Map<any, any>;
		}
		| undefined;
	children?: any;
}) => React.FunctionComponentElement<any>;
export let PanelHeader: Function;
export let PanelContent: React.ForwardRefExoticComponent<any>;
export let PanelSkeleton: Function;

export let Snackbar: {
	wrapper: Function;
	simpleLayout: Function;
	ctaText: Function;
	styledImage: Function;
};
export let FilterBox: React.NamedExoticComponent;
export let ScrollableContainer: React.FC<any>;
export let ScrollableText: React.FC<any>;
export let Toggle: Function;
export let Router: Function;
export let Routes: Function;
export let Route: Function;
export let StoreProvider: Function;

export let GenericModal: Function;

export let Tracklist: React.NamedExoticComponent;
export let TracklistRow: React.NamedExoticComponent;
export let TracklistColumnsContextProvider: Function;

CHUNKS.xpui.promise.then(() => {
	Menus = Object.fromEntries(
		exportedMemos.flatMap((m) => {
			const str = (m as any).type.toString() as string;
			const match = str.match(/value:"([\w-]+)"/);
			const name = match?.[1] ?? "";
			const type = {
				album: "Album",
				show: "PodcastShow",
				artist: "Artist",
				track: "Track",
			}[name];
			return type ? [[type, m]] : [];
		}),
	);

	const [ContextMenuModuleID] = chunks.find(([_, v]) => v.toString().includes("toggleContextMenu"))!;
	const [playlistMenuChunkID] = chunks.find(
		([, v]) =>
			v.toString().includes('value:"playlist"') &&
			v.toString().includes("canView") &&
			v.toString().includes("permissions"),
	)!;

	Menus.Playlist = Object.values(require(playlistMenuChunkID)).find(
		(m) => typeof m === "function" || typeof m === "object",
	);

	Cards = Object.assign(
		{
			Generic: findBy("cardPlayButtonFactory", "featureIdentifier", "variant")(exportedFunctions),
			HeroGeneric: findBy(
				"cardPlayButtonFactory",
				"featureIdentifier",
				"getSignifierContent",
			)(exportedFunctions),
			CardImage: findBy('"card-image"')(exportedFunctions),
		},
		Object.fromEntries(
			[
				exportedFunctions.map((m) => {
					try {
						const str = m.toString();
						const match = str.match(/featureIdentifier:"(.+?)"/);
						if (!match) return [];
						const name = match[1];
						return [[capitalize(name), m]];
					} catch (e) {
						return [];
					}
				}),
				exportedMemos.map((m) => {
					try {
						const str = (m as any).type.toString();
						const match = str.match(/featureIdentifier:"(.+?)"/);
						if (!match) return [];
						const name = match[1];
						return [[capitalize(name), m]];
					} catch (e) {
						return [];
					}
				}),
			].flat(2),
		),
	);

	RemoteConfigProviderComponent = findBy("resolveSuspense", "configuration")(exportedFunctions);

	Slider = exportedFunctions.find(
		(m) => m.toString().includes("onStepBackward") && !m.toString().includes("volume"),
	);

	const exportedMemoFRefs = exportedMemos.filter(
		(m) => (m as any).type.$$typeof === Symbol.for("react.forward_ref"),
	);
	Nav = exportedMemoFRefs.find((m) => (m as any).type.render.toString().includes("navigationalRoot"))!;
	NavTo = exportedMemoFRefs.find((m) => (m as any).type.render.toString().includes("pageId"))!;

	InstrumentedRedirect = findBy("getInteractionId")(exportedFunctions);

	SnackbarProvider = findBy("enqueueSnackbar called with invalid argument")(
		exportedFunctions,
	) as unknown as SnackbarProvider;

	ContextMenu = Object.values(require(ContextMenuModuleID))[0];
	RightClickMenu = findBy("action", "open", "trigger", "right-click")(exportedFunctions);

	ConfirmDialog = findBy("isOpen", "shouldCloseOnEsc", "onClose")(exportedFunctions);
	Tooltip = findBy("hover-or-focus", "tooltip")(exportedFunctions);

	Menu = findBy("getInitialFocusElement", "children")(exportedFunctions);
	MenuItem = findBy("handleMouseEnter", "onClick")(exportedFunctions);
	MenuItemSubMenu = findBy("subMenuIcon")(exportedFunctions);

	RemoteConfigProvider = ({
		configuration = Platform.getRemoteConfiguration(),
		children = undefined as any,
	}) => React.createElement(RemoteConfigProviderComponent, { configuration }, children);

	PanelHeader = exportedFunctions.find(
		(m) => m.toString().includes("panel") && m.toString().includes("actions"),
	)!;
	PanelContent = exportedForwardRefs.find((f) => f.render.toString().includes("fixedHeader"));
	PanelSkeleton = findBy("label", "aside")(exportedFunctions) ||
		findBy((m) => m.render.toString().includes("section"))(exportedForwardRefs);

	Snackbar = {
		wrapper: findBy("encore-light-theme", "elevated")(exportedFunctions),
		simpleLayout: findBy("leading", "center", "trailing")(exportedFunctions),
		ctaText: findBy("ctaText")(exportedFunctions),
		styledImage: findBy("placeholderSrc")(exportedFunctions),
	};

	FilterBox = exportedMemos.find((f) => (f as any).type.toString().includes("filterBoxApiRef"))!;
	ScrollableContainer = findBy("scrollLeft", "showButtons")(exportedFunctions);
	ScrollableText = findBy("scrollLeft", "pauseAtEndEdgeDurationMs")(exportedFunctions);
	Toggle = findBy("onSelected", 'type:"checkbox"')(exportedFunctions);
	Router = findBy("navigationType", "static")(exportedFunctions);
	Routes = findBy(
		/\([a-zA-Z_\$][\w\$]*\)\{let\{children:[a-zA-Z_\$][\w\$]*,location:[a-zA-Z_\$][\w\$]*\}=[a-zA-Z_\$][\w\$]*/,
	)(exportedFunctions);
	Route = findBy(
		/^function [a-zA-Z_\$][\w\$]*\([a-zA-Z_\$][\w\$]*\)\{\(0,[a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*\)\(\!1\)\}$/,
	)(exportedFunctions);
	StoreProvider = findBy("notifyNestedSubs", "serverState")(exportedFunctions);

	GenericModal = findBy("GenericModal")(exportedFunctions);

	Tracklist = exportedMemos.find((f) => (f as any).type.toString().includes("nrValidItems"))!;
	TracklistRow = exportedMemos.find((f) => (f as any).type.toString().includes("track-icon"))!;
	TracklistColumnsContextProvider = findBy("columns", "visibleColumns", "toggleVisible")(exportedFunctions);

	SettingsToggle = findBy("condensed", "onSelected")(exportedFunctions);
});

(CHUNKS["/xpui-desktop-routes-settings.js"] ??= Promise.withResolvers()).promise.then(() => {
	const { modules } = analyzeWebpackRequire(require);
	Settings = modules.find((m) => m.SettingsRow);
});
