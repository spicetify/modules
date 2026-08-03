/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */


import { findBy, toPascalCase } from "../util.ts";

import { warn } from "../logger.ts";

import { Platform } from "../expose/Platform.ts";
import { exportedFunctions, exportedMemos, modules, src } from "./index.ts";
import { webpackRequire } from "../wpunpk.mix.ts";
import { React } from "../expose/React.ts";

type SnackbarProviderT = any;

await CHUNKS.xpui.promise;

export const Menus: any = Object.fromEntries(
	exportedMemos.flatMap((m) => {
		const str = src((m as any).type);
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

// Needle misses are version drift, not fatal errors: a miss costs one
// surface member (undefined), never the whole stdlib barrel. The warning
// names the needle so a needle refresh can target it.
const findModuleId = (needle: string, pred: (source: string) => boolean) => {
	const hit = modules.find(([, v]) => pred(v.toString()));
	if (!hit) warn("[stdlib] webpack needle miss:", needle);
	return hit?.[0];
};
const requireExports = (id: ReturnType<typeof findModuleId>): Record<string, any> =>
	id === undefined ? {} : (webpackRequire(id) as Record<string, any>);

const ContextMenuModuleID = findModuleId("toggleContextMenu", (s) => s.includes("toggleContextMenu"));
// Dead since 1.2.9x: no module carries value:"playlist" + canView +
// permissions anymore; Menus.Playlist stays undefined until re-needled.
const playlistMenuModuleID = findModuleId(
	'value:"playlist" + canView + permissions',
	(s) => s.includes('value:"playlist"') && s.includes("canView") && s.includes("permissions"),
);

Menus.Playlist = Object.values(requireExports(playlistMenuModuleID)).find(
	(m) => typeof m === "function" || typeof m === "object",
);

export const Cards: any = Object.assign(
	{
		Generic: exportedFunctions.find(
			(f) =>
				src(f).includes("OnMouseDown") &&
				src(f).match(/^[^;]*headerText/) &&
				src(f).match(/^[^;]*featureIdentifier/) &&
				src(f).match(/^[^;]*renderCardImage/),
		),
		HeroGeneric: findBy("cardPlayButtonFactory", "featureIdentifier", "getSignifierContent")(exportedFunctions),
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
)(exportedFunctions);

const exportedMemoFRefs = exportedMemos.filter((m) => (m as any).type.$$typeof === Symbol.for("react.forward_ref"));
export const Nav: React.NamedExoticComponent<any> = exportedMemoFRefs.find((m) =>
	src((m as any).type.render).includes("navigationalRoot"),
)!;
export const NavTo: React.NamedExoticComponent<any> = exportedMemoFRefs.find((m) =>
	src((m as any).type.render).includes("pageId"),
)!;

export const InstrumentedRedirect: React.FC<any> = exportedFunctions.find(
	(f) => src(f).includes("getInteractionId") && /\bto:/.test(src(f)),
);

export const SnackbarProvider: SnackbarProviderT = findBy("enqueueSnackbar called with invalid argument")(
	exportedFunctions,
) as unknown as SnackbarProviderT;

export const ContextMenu: any = Object.values(requireExports(ContextMenuModuleID))[0];
export const RightClickMenu: React.FC<any> = findBy("action", "open", "trigger", "right-click")(exportedFunctions);

// export const ConfirmDialog: React.FC<any> = findBy(
// 	"isOpen",
// 	"shouldCloseOnEsc",
// 	"onClose",
// )(exportedFunctions);
export const Tooltip: React.FC<any> = findBy("hover-or-focus", "tooltip")(exportedFunctions);

export const Menu: React.FC<any> = findBy("getInitialFocusElement", "children")(exportedFunctions);
export const MenuItem: React.FC<any> = findBy("handleMouseEnter", "onClick")(exportedFunctions);
export const MenuItemSubMenu: React.FC<any> = findBy("subMenuIcon")(exportedFunctions);

export const RemoteConfigProvider = ({
	configuration = Platform.getRemoteConfiguration(),
	children = undefined as React.ReactNode,
}) => React.createElement(RemoteConfigProviderComponent, { configuration }, children);
export const Snackbar = {
	wrapper: findBy("encore-light-theme", "elevated")(exportedFunctions),
	simpleLayout: findBy("leading", "center", "trailing")(exportedFunctions),
	ctaText: findBy("ctaText")(exportedFunctions),
	styledImage: findBy("placeholderSrc")(exportedFunctions),
};

export const FilterBox: React.NamedExoticComponent = exportedMemos.find((f) =>
	src((f as any).type).includes("filterBoxApiRef"),
)!;
export const ScrollableContainer: React.FC<any> = findBy("scrollLeft", "showButtons")(exportedFunctions);
export const ScrollableText: React.FC<any> = findBy("scrollLeft", "pauseAtEndEdgeDurationMs")(exportedFunctions);
export const Router: React.FC<any> = findBy("navigationType", "static")(exportedFunctions);
export const Routes: React.FC<any> = findBy(
	/\([a-zA-Z_\$][\w\$]*\)\{let\{children:[a-zA-Z_\$][\w\$]*,location:[a-zA-Z_\$][\w\$]*\}=[a-zA-Z_\$][\w\$]*/,
)(exportedFunctions);
export const Route: React.FC<any> = findBy(
	/^function [a-zA-Z_\$][\w\$]*\([a-zA-Z_\$][\w\$]*\)\{\(0,[a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*\)\(\!1\)\}$/,
)(exportedFunctions);
export const StoreProvider: React.FC<any> = findBy("notifyNestedSubs", "serverState")(exportedFunctions);

export const GenericModal: React.FC<any> = findBy("isOpen", "contentLabel")(exportedFunctions);

export const Tracklist: React.FC<any> = exportedMemos.find((f) => src((f as any).type).includes("nrValidItems"))!;
export const TracklistColumnsContextProvider: React.FC<any> = findBy(
	"columns",
	"visibleColumns",
	"toggleVisible",
)(exportedFunctions);
