/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { toPascalCase } from "/hooks/std/text.ts";
import { findBy } from "/hooks/util.ts";

import { Platform } from "../expose/Platform.ts";
import { exportedForwardRefs, exportedFunctions, exportedMemos, modules } from "./index.ts";
import { webpackRequire } from "../wpunpk.mix.ts";
import { React } from "../expose/React.ts";

import type { SnackbarProvider as SnackbarProviderT } from "npm:notistack";

await CHUNKS.xpui.promise;

export const Menus: any = Object.fromEntries(
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

const [ContextMenuModuleID] = modules.find(([_, v]) => v.toString().includes("toggleContextMenu"))!;
const [playlistMenuModuleID] = modules.find(
	([, v]) =>
		v.toString().includes('value:"playlist"') &&
		v.toString().includes("canView") &&
		v.toString().includes("permissions"),
)!;

Menus.Playlist = Object.values(webpackRequire(playlistMenuModuleID)).find(
	(m) => typeof m === "function" || typeof m === "object",
);

export const Cards: any = Object.assign(
	{
		Generic: exportedFunctions.find((f) =>
			f.toString().includes("OnMouseDown") &&
			f.toString().match(/^[^;]*headerText/) &&
			f.toString().match(/^[^;]*featureIdentifier/) &&
			f.toString().match(/^[^;]*renderCardImage/)
		),
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
					return [[toPascalCase(name), m]];
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
					return [[toPascalCase(name), m]];
				} catch (e) {
					return [];
				}
			}),
		].flat(2),
	),
);

export const RemoteConfigProviderComponent: React.FC<any> = findBy(
	"resolveSuspense",
	"configuration",
)(
	exportedFunctions,
);

const exportedMemoFRefs = exportedMemos.filter(
	(m) => (m as any).type.$$typeof === Symbol.for("react.forward_ref"),
);
export const Nav: React.NamedExoticComponent = exportedMemoFRefs.find((m) =>
	(m as any).type.render.toString().includes("navigationalRoot")
)!;
export const NavTo: React.NamedExoticComponent = exportedMemoFRefs.find((m) =>
	(m as any).type.render.toString().includes("pageId")
)!;

export const InstrumentedRedirect: React.FC<any> = exportedFunctions.find((f) =>
	f.toString().includes("getInteractionId") && /\bto:/.test(f)
);

export const SnackbarProvider: SnackbarProviderT = findBy(
	"enqueueSnackbar called with invalid argument",
)(
	exportedFunctions,
) as unknown as SnackbarProvider;

export const ContextMenu: any = Object.values(webpackRequire(ContextMenuModuleID))[0];
export const RightClickMenu: React.FC<any> = findBy(
	"action",
	"open",
	"trigger",
	"right-click",
)(
	exportedFunctions,
);

// export const ConfirmDialog: React.FC<any> = findBy(
// 	"isOpen",
// 	"shouldCloseOnEsc",
// 	"onClose",
// )(exportedFunctions);
export const Tooltip: React.FC<any> = findBy("hover-or-focus", "tooltip")(
	exportedFunctions,
);

export const Menu: React.FC<any> = findBy("getInitialFocusElement", "children")(
	exportedFunctions,
);
export const MenuItem: React.FC<any> = findBy("handleMouseEnter", "onClick")(
	exportedFunctions,
);
export const MenuItemSubMenu: React.FC<any> = findBy("subMenuIcon")(
	exportedFunctions,
);

export const RemoteConfigProvider = ({
	configuration = Platform.getRemoteConfiguration(),
	children = undefined as React.ReactNode,
}) =>
	React.createElement(
		RemoteConfigProviderComponent,
		{ configuration },
		children,
	);
export const Snackbar = {
	wrapper: findBy("encore-light-theme", "elevated")(exportedFunctions),
	simpleLayout: findBy("leading", "center", "trailing")(exportedFunctions),
	ctaText: findBy("ctaText")(exportedFunctions),
	styledImage: findBy("placeholderSrc")(exportedFunctions),
};

export const FilterBox: React.NamedExoticComponent = exportedMemos.find((f) =>
	(f as any).type.toString().includes("filterBoxApiRef")
)!;
export const ScrollableContainer: React.FC<any> = findBy(
	"scrollLeft",
	"showButtons",
)(exportedFunctions);
export const ScrollableText: React.FC<any> = findBy(
	"scrollLeft",
	"pauseAtEndEdgeDurationMs",
)(
	exportedFunctions,
);
export const Router: React.FC<any> = findBy("navigationType", "static")(
	exportedFunctions,
);
export const Routes: React.FC<any> = findBy(
	/\([a-zA-Z_\$][\w\$]*\)\{let\{children:[a-zA-Z_\$][\w\$]*,location:[a-zA-Z_\$][\w\$]*\}=[a-zA-Z_\$][\w\$]*/,
)(exportedFunctions);
export const Route: React.FC<any> = findBy(
	/^function [a-zA-Z_\$][\w\$]*\([a-zA-Z_\$][\w\$]*\)\{\(0,[a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*\)\(\!1\)\}$/,
)(exportedFunctions);
export const StoreProvider: React.FC<any> = findBy(
	"notifyNestedSubs",
	"serverState",
)(exportedFunctions);

export const GenericModal: React.FC<any> = findBy("isOpen", "contentLabel")(
	exportedFunctions,
);

export const Tracklist: React.FC<any> = exportedMemos.find((f) =>
	(f as any).type.toString().includes("nrValidItems")
)!;
export const TracklistColumnsContextProvider: React.FC<any> = findBy(
	"columns",
	"visibleColumns",
	"toggleVisible",
)(
	exportedFunctions,
);
