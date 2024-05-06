/* Copyright © 2024
 *      Delusoire <deluso7re@outlook.com>
 *
 * This file is part of bespoke/modules/stdlib.
 *
 * bespoke/modules/stdlib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * bespoke/modules/stdlib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with bespoke/modules/stdlib. If not, see <https://www.gnu.org/licenses/>.
 */

import { capitalize } from "../../deps.js";
import { findBy } from "/hooks/util.js";

import type { EnqueueSnackbar as EnqueueSnackbarT, OptionsObject as OptionsObjectT } from "notistack";
import type {
	NamedExoticComponent as NamedExoticComponentT,
	ForwardRefExoticComponent as ForwardRefExoticComponentT,
	Context as ContextT,
} from "react";
import type { Flipped as FlippedT, Flipper as FlipperT } from "react-flip-toolkit";
import type { SnackbarProvider as SnackbarProviderT, useSnackbar as useSnackbarT } from "notistack";
import type SnackbarT from "notistack";
import type ReactDOMT from "react-dom";
import type ReactDOMServerT from "react-dom/server";
import type classNamesT from "classnames";
import type {
	QueryClient as QueryClientT,
	QueryClientProvider as QueryClientProviderT,
	notifyManager as notifyManagerT,
	useMutation as useMutationT,
	useQuery as useQueryT,
	useQueryClient as useQueryClientT,
	useSuspenseQuery as useSuspenseQueryT,
	useInfiniteQuery as useInfiniteQueryT,
} from "@tanstack/react-query";
import type MousetrapT from "mousetrap";

export type EnqueueSnackbar = EnqueueSnackbarT;
export type OptionsObject = OptionsObjectT;

export type NamedExoticComponent = NamedExoticComponentT;
export type ForwardRefExoticComponent<P> = ForwardRefExoticComponentT<P>;
export type Context<T> = ContextT<T>;

export type Flipped = typeof FlippedT;
export type Flipper = FlipperT;

export type SnackbarProvider = SnackbarProviderT;
export type useSnackbar = typeof useSnackbarT;

export type Snackbar = typeof SnackbarT;
export type ReactDOM = typeof ReactDOMT;
export type ReactDOMServer = typeof ReactDOMServerT;
export type classNames = typeof classNamesT;

export type QueryClient = QueryClientT;
export type QueryClientProvider = typeof QueryClientProviderT;
export type notifyManager = typeof notifyManagerT;
export type useMutation = typeof useMutationT;
export type useQuery = typeof useQueryT;
export type useQueryClient = typeof useQueryClientT;
export type useSuspenseQuery = typeof useSuspenseQueryT;
export type useInfiniteQuery = typeof useInfiniteQueryT;

export type Mousetrap = typeof MousetrapT;

import type { Platform } from "./platform.js";

type ParsableAsURI = any;

type IsThisURIType<A extends keyof URITypes> = (url: ParsableAsURI) => url is URIClass<A>;

export type URIClass<A extends keyof URITypes> = any;

export type URITypes = {
	AD: "ad";
	ALBUM: "album";
	GENRE: "genre";
	QUEUE: "queue";
	APPLICATION: "application";
	ARTIST: "artist";
	ARTIST_TOPLIST: "artist-toplist";
	ARTIST_CONCERTS: "artist-concerts";
	AUDIO_FILE: "audiofile";
	COLLECTION: "collection";
	COLLECTION_ALBUM: "collection-album";
	COLLECTION_ARTIST: "collection-artist";
	COLLECTION_MISSING_ALBUM: "collection-missing-album";
	COLLECTION_TRACK_LIST: "collectiontracklist";
	CONCEPT: "concept";
	CONCERT: "concert";
	CONTEXT_GROUP: "context-group";
	CULTURAL_MOMENT: "cultural-moment";
	DAILY_MIX: "dailymix";
	EMPTY: "empty";
	EPISODE: "episode";
	FACEBOOK: "facebook";
	FOLDER: "folder";
	FOLLOWERS: "followers";
	FOLLOWING: "following";
	IMAGE: "image";
	INBOX: "inbox";
	INTERRUPTION: "interruption";
	LIBRARY: "library";
	LIVE: "live";
	ROOM: "room";
	EXPRESSION: "expression";
	LOCAL: "local";
	LOCAL_TRACK: "local";
	LOCAL_ALBUM: "local-album";
	LOCAL_ARTIST: "local-artist";
	MERCH: "merch";
	MERCHHUB: "merchhub";
	MOSAIC: "mosaic";
	PLAYLIST: "playlist";
	PLAYLIST_V2: "playlist-v2";
	PRERELEASE: "prerelease";
	PROFILE: "profile";
	PUBLISHED_ROOTLIST: "published-rootlist";
	RADIO: "radio";
	ROOTLIST: "rootlist";
	SEARCH: "search";
	SHOW: "show";
	SOCIAL_SESSION: "socialsession";
	SPECIAL: "special";
	STARRED: "starred";
	STATION: "station";
	TEMP_PLAYLIST: "temp-playlist";
	TOPLIST: "toplist";
	TRACK: "track";
	TRACKSET: "trackset";
	USER_TOPLIST: "user-toplist";
	USER_TOP_TRACKS: "user-top-tracks";
	UNKNOWN: "unknown";
	VIDEO: "video";
	MEDIA: "media";
	QUESTION: "question";
	POLL: "poll";
	RESPONSE: "response";
	COURSE: "course";
	LESSON: "lesson";
	CANVAS: "canvas";
};

type WebpackRequire = any;

export type ExposedWebpack = ReturnType<typeof expose>;

// ! Clean this file

const exposeReactComponentsUI = ({ exports, exportedFunctions, exportedForwardRefs }: Webpack) => {
	const componentNames = Object.keys(exports.find(e => e.BrowserDefaultFocusStyleProvider));
	const componentRegexes = componentNames.map(n => new RegExp(`"data-encore-id":(?:[a-zA-Z_\$][\w\$]*\\.){2}${n}\\b`));
	const componentPairs = [exportedFunctions.map(f => [f, f]), exportedForwardRefs.map(f => [f.render, f])]
		.flat()
		.map(([s, f]) => [componentNames.find((n, i) => s.toString().match(componentRegexes[i])), f]);
	return Object.fromEntries(componentPairs);
};

const exposeReactComponents = (webpack: Webpack, React: React, Platform: Platform) => {
	const { require, chunks, modules, exports, exportedFunctions, exportedMemos, exportedForwardRefs } = webpack;

	const exportedFCs = exportedFunctions as React.FC<any>[];

	const Menus = Object.fromEntries(
		exportedMemos.flatMap(m => {
			const str = (m as any).type.toString();
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

	const Cards = Object.assign(
		{
			Generic: findBy("cardPlayButtonFactory", "featureIdentifier", "variant")(exportedFCs),
			HeroGeneric: findBy("cardPlayButtonFactory", "featureIdentifier", "getSignifierContent")(exportedFCs),
			CardImage: findBy('"card-image"')(exportedFCs),
		},
		Object.fromEntries(
			[
				exportedFCs.map(m => {
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
				exportedMemos.map(m => {
					try {
						const str = m.type.toString();
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

	const [ContextMenuModuleID] = chunks.find(([_, v]) => v.toString().includes("toggleContextMenu"));
	const [playlistMenuChunkID] = chunks.find(
		([, v]) => v.toString().includes('value:"playlist"') && v.toString().includes("canView") && v.toString().includes("permissions"),
	);

	Menus.Playlist = Object.values(require(playlistMenuChunkID)).find(m => typeof m === "function" || typeof m === "object");

	const RemoteConfigProviderComponent = findBy("resolveSuspense", "configuration")(exportedFCs) as React.FC<any>;

	const Slider = exportedFCs.find(m => m.toString().includes("onStepBackward") && !m.toString().includes("volume")) as React.FC<any>;

	const exportedMemoFRefs = exportedMemos.filter(m => m.type.$$typeof === Symbol.for("react.forward_ref"));
	const Nav = exportedMemoFRefs.find(m => m.type.render.toString().includes("navigationalRoot"));
	const NavTo = exportedMemoFRefs.find(m => m.type.render.toString().includes("pageId"));

	const { InstrumentedRedirect } = modules.find(e => e.InstrumentedRedirect);

	return {
		UI: exposeReactComponentsUI(webpack),
		SnackbarProvider: findBy("enqueueSnackbar called with invalid argument")(exportedFunctions) as unknown as SnackbarProvider,

		SettingColumn: findBy("setSectionFilterMatchQueryValue", "filterMatchQuery")(exportedFCs),
		SettingText: findBy("textSubdued", "dangerouslySetInnerHTML")(exportedFCs),
		SettingToggle: findBy("condensed", "onSelected")(exportedFCs),

		ContextMenu: Object.values(require(ContextMenuModuleID))[0],
		RightClickMenu: findBy("action", "open", "trigger", "right-click")(exportedFCs),

		ConfirmDialog: findBy("isOpen", "shouldCloseOnEsc", "onClose")(exportedFCs),
		Tooltip: findBy("hover-or-focus", "tooltip")(exportedFCs),

		Menu: findBy("getInitialFocusElement", "children")(exportedFCs),
		MenuItem: findBy("handleMouseEnter", "onClick")(exportedFCs),
		MenuItemSubMenu: findBy("subMenuIcon")(exportedFCs),
		Slider,
		Nav,
		NavTo,
		RemoteConfigProvider: ({ configuration = Platform.getRemoteConfiguration(), children }) =>
			React.createElement(RemoteConfigProviderComponent, { configuration }, children),

		PanelHeader: exportedFCs.find(m => m.toString().includes("panel") && m.toString().includes("actions")),
		PanelContent:
			findBy(m => m.render.toString().includes("scrollBarContainer"))(exportedForwardRefs) || findBy("scrollBarContainer")(exportedFCs),
		PanelSkeleton: findBy("label", "aside")(exportedFCs) || findBy(m => m.render.toString().includes("section"))(exportedForwardRefs),

		Snackbar: {
			wrapper: findBy("encore-light-theme", "elevated")(exportedFCs),
			simpleLayout: findBy("leading", "center", "trailing")(exportedFCs),
			ctaText: findBy("ctaText")(exportedFCs),
			styledImage: findBy("placeholderSrc")(exportedFCs),
		},

		FilterBox: exportedMemos.find(f => f.type.toString().includes("filterBoxApiRef")),
		ScrollableContainer: findBy("scrollLeft", "showButtons")(exportedFunctions) as React.FC<any>,
		ScrollableText: findBy("scrollLeft", "pauseAtEndEdgeDurationMs")(exportedFunctions) as React.FC<any>,
		Toggle: findBy("onSelected", 'type:"checkbox"')(exportedFCs),
		Router: findBy("navigationType", "static")(exportedFCs),
		Routes: findBy(/\([a-zA-Z_\$][\w\$]*\)\{let\{children:[a-zA-Z_\$][\w\$]*,location:[a-zA-Z_\$][\w\$]*\}=[a-zA-Z_\$][\w\$]*/)(exportedFCs),
		Route: findBy(/^function [a-zA-Z_\$][\w\$]*\([a-zA-Z_\$][\w\$]*\)\{\(0,[a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*\)\(\!1\)\}$/)(exportedFCs),
		StoreProvider: findBy("notifyNestedSubs", "serverState")(exportedFCs),

		Cards,
		Menus,
		GenericModal: findBy("GenericModal")(exportedFCs),

		Tracklist: exportedMemos.find(f => f.type.toString().includes("nrValidItems")),
		TracklistRow: exportedMemos.find(f => f.type.toString().includes("track-icon")),
		TracklistColumnsContextProvider: findBy("columnType")(exportedFunctions),
		InstrumentedRedirect,
	};
};

const exposeURI = ({ require, chunks }: Webpack) => {
	const [URIModuleID] = chunks.find(([id, v]) => v.toString().includes("Invalid Spotify URI!") && Object.keys(require(id)).length > 10);
	const URIModule = require(URIModuleID);
	const [Types, ...vs] = Object.values(URIModule) as [URITypes, ...Function[]];
	const TypesKeys = Object.keys(Types);

	const isTestFn = fn => TypesKeys.some(t => fn.toString().includes(`${t}}`));
	const isCreateFn = fn => TypesKeys.some(t => fn.toString().includes(`${t},`));

	const CaseLikeThis = s => s.split("_").map(capitalize).join("");

	const fnsByType = Object.groupBy(vs, fn => (isTestFn(fn) ? "test" : isCreateFn(fn) ? "create" : undefined));
	const is = Object.fromEntries(fnsByType.test.map(fn => [CaseLikeThis(fn.toString().match(/([\w_\d]{2,})\}/)[1]), fn])) as {
		Ad: IsThisURIType<any>;
		Album: IsThisURIType<any>;
		Application: IsThisURIType<any>;
		Artist: IsThisURIType<any>;
		CollectionAlbum: IsThisURIType<any>;
		CollectionArtist: IsThisURIType<any>;
		Collection: IsThisURIType<any>;
		Concert: IsThisURIType<any>;
		Episode: IsThisURIType<any>;
		Folder: IsThisURIType<any>;
		LocalTrack: IsThisURIType<any>;
		Playlist: IsThisURIType<any>;
		PlaylistV2: IsThisURIType<any>;
		Profile: IsThisURIType<any>;
		Radio: IsThisURIType<any>;
		Show: IsThisURIType<any>;
		SocialSession: IsThisURIType<any>;
		Station: IsThisURIType<any>;
		Track: IsThisURIType<any>;
	};
	const create = Object.fromEntries(fnsByType.create.map(fn => [CaseLikeThis(fn.toString().match(/([\w_\d]{2,})\,/)[1]), fn])) as {
		Album: any;
		Application: any;
		Artist: any;
		CollectionAlbum: any;
		CollectionArtist: any;
		Collection: any;
		Concert: any;
		Episode: any;
		Folder: any;
		LocalAlbum: any;
		LocalArtist: any;
		PlaylistV2: any;
		Prerelease: any;
		Profile: any;
		Queue: any;
		Search: any;
		Show: any;
		SocialSession: any;
		Station: any;
		Track: any;
		UserToplist: any;
	};
	const uniqueFns = fnsByType[undefined as keyof typeof fnsByType];

	const findAndExcludeBy = (...strings) => {
		const i = uniqueFns.findIndex(f => strings.every(str => f.toString().includes(str)));
		return uniqueFns.splice(i, 1)[0];
	};

	const isSameIdentity = findAndExcludeBy("PLAYLIST") as (a: ParsableAsURI, b: ParsableAsURI) => boolean;
	const urlEncode = findAndExcludeBy(".URI") as (str: string) => string;
	const idToHex = findAndExcludeBy("22===") as (str: string) => string;
	const hexToId = findAndExcludeBy("32===") as (str: string) => string;
	const from = findAndExcludeBy("allowedTypes") as (uri: ParsableAsURI) => URIClass<any>;
	const fromString = findAndExcludeBy("Argument `uri` must be a string.") as (str: string) => URIClass<any>;

	const is_PlaylistV1orV2 = findAndExcludeBy(`${is.Playlist.name}(e)||${is.PlaylistV2.name}(e)`) as IsThisURIType<any>;

	return {
		Types,
		isSameIdentity,
		urlEncode,
		idToHex,
		hexToId,
		from,
		fromString,
		is: Object.assign(is, {
			PlaylistV1OrV2: is_PlaylistV1orV2,
		}),
		create,
	};
};

type Webpack = ReturnType<typeof exposeWebpack>;
const exposeWebpack = () => {
	const require = globalThis.webpackChunkclient_web.push([[Symbol()], {}, re => re]) as WebpackRequire;
	const chunks = Object.entries(require.m);
	const modules = chunks.map(([id]) => require(id));
	const exports = modules
		.filter(module => typeof module === "object")
		.flatMap(module => {
			try {
				return Object.values(module);
			} catch (_) {}
		})
		.filter(Boolean) as any[];

	// biome-ignore lint/complexity/noBannedTypes: ffs
	const isFunction = (obj): obj is Function => typeof obj === "function";
	const exportedFunctions = exports.filter(isFunction);

	const exportedReactObjects = Object.groupBy(exports, x => x.$$typeof);
	const exportedContexts = exportedReactObjects[Symbol.for("react.context") as any] as Array<Context<any>>;
	const exportedForwardRefs = exportedReactObjects[Symbol.for("react.forward_ref") as any] as Array<ForwardRefExoticComponent<any>>;
	const exportedMemos = exportedReactObjects[Symbol.for("react.memo") as any] as Array<NamedExoticComponent>;

	return {
		require,
		chunks,
		modules,
		exports,
		exportedFunctions,
		exportedContexts,
		exportedForwardRefs,
		exportedMemos,
	};
};

const exposeReactRouter = ({ require, chunks }: Webpack) => {
	const [ReactRouterModuleID] = chunks.find(([_, v]) => v.toString().includes("React Router"));
	const ReactRouterModule = Object.values(require(ReactRouterModuleID));

	// https://github.com/remix-run/react-router/blob/main/packages/react-router/lib/hooks.tsx#L131
	const useMatch = findBy("let{pathname:", /\(([a-zA-Z_\$][\w\$]*),([a-zA-Z_\$][\w\$]*)\)\),\[\2,\1\]/)(ReactRouterModule);

	return { useMatch };
};

const exposeReactFlipToolkit = ({ exportedFunctions }: Webpack) => {
	const Flipper = exportedFunctions.find(m => m.prototype?.getSnapshotBeforeUpdate) as unknown as Flipper;
	const Flipped = exportedFunctions.find(m => (m as any).displayName === "Flipped") as Flipped;

	return {
		Flipper,
		Flipped,
	};
};

const exposeReact = ({ modules }: Webpack) => {
	const ReactJSX = modules.find(m => m.jsx);
	const ReactDOM = modules.find(m => m.createRoot) as ReactDOM;
	const ReactDOMServer = modules.find(m => m.renderToString) as ReactDOMServer;

	return { ReactJSX, ReactDOM, ReactDOMServer };
};

const exposeSpotifyReactHooks = ({ exportedFunctions }: Webpack) => {
	const DragHandler = findBy("dataTransfer", "data-dragging")(exportedFunctions);
	const useExtractedColor = exportedFunctions.find(
		m => m.toString().includes("extracted-color") || (m.toString().includes("colorRaw") && m.toString().includes("useEffect")),
	);
	return { DragHandler, useExtractedColor };
};

const exposeReactQuery = ({ require, chunks, modules, exportedFunctions }: Webpack) => {
	const [infiniteQueryChunkID] = chunks.find(
		([_, v]) => v.toString().includes("fetchPreviousPage") && v.toString().includes("getOptimisticResult"),
	);

	const QueryClient = findBy("defaultMutationOptions")(exportedFunctions) as unknown as QueryClient;
	const PersistQueryClientProvider = findBy("persistOptions")(exportedFunctions);
	const QueryClientProvider = findBy("use QueryClientProvider")(exportedFunctions) as QueryClientProvider;
	const notifyManager = modules.find(m => m.setBatchNotifyFunction) as notifyManager;
	const useMutation = findBy("mutateAsync")(exportedFunctions) as useMutation;
	const useQuery = findBy(
		/^function [a-zA-Z_\$][\w\$]*\(([a-zA-Z_\$][\w\$]*),([a-zA-Z_\$][\w\$]*)\)\{return\(0,[a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*\)\(\1,[a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*,\2\)\}$/,
	)(exportedFunctions) as useQuery;
	const useQueryClient = findBy("client", "Provider", "mount")(exportedFunctions) as useQueryClient;
	const useSuspenseQuery = findBy("throwOnError", "suspense", "enabled")(exportedFunctions) as useSuspenseQuery;
	const useInfiniteQuery = Object.values(require(infiniteQueryChunkID)).find(m => typeof m === "function") as useInfiniteQuery;

	return {
		QueryClient,
		PersistQueryClientProvider,
		QueryClientProvider,
		notifyManager,
		useMutation,
		useQuery,
		useQueryClient,
		useSuspenseQuery,
		useInfiniteQuery,
	};
};

const exposeClassnames = ({ require, chunks }: Webpack) => {
	const [classnamesModuleID] = chunks.find(([_, v]) => v.toString().includes("[native code]") && !v.toString().includes("<anonymous>"));
	const classnames = require(classnamesModuleID) as classNames;

	return { classnames };
};

const exposeMousetrap = ({ modules }: Webpack) => {
	const Mousetrap = modules.find(m => m.addKeycodes) as Mousetrap;

	return { Mousetrap };
};

const exposeSnackbar = ({ exportedFunctions }: Webpack) => {
	const useSnackbar = findBy(/^function\(\)\{return\(0,[a-zA-Z_\$][\w\$]*\.useContext\)\([a-zA-Z_\$][\w\$]*\)\}$/)(
		exportedFunctions,
	) as useSnackbar;

	type FN_enqueueCustomSnackbar_OPTS = (Omit<OptionsObject, "key"> & { keyPrefix: string }) | (OptionsObject & { identifier: string });
	const enqueueCustomSnackbar = findBy("enqueueCustomSnackbar", "headless")(exportedFunctions) as (
		element: React.ReactElement,
		opts: FN_enqueueCustomSnackbar_OPTS,
	) => ReturnType<EnqueueSnackbar>;

	return { useSnackbar, enqueueCustomSnackbar };
};

const exposeSpotifyReactContexts = ({ exportedContexts }: Webpack) => {
	const FilterContext = exportedContexts.find(c => c._currentValue2?.setFilter);

	return { FilterContext };
};

// TODO: extract functions
export function expose({ Snackbar, Platform, React }: { Snackbar: Snackbar; Platform: Platform; React: React }) {
	const webpack = exposeWebpack();
	const { exports, exportedFunctions } = webpack;

	const useContextMenuState = findBy("useContextMenuState")(exportedFunctions);

	const Color = Object.assign(findBy("static fromHex")(exportedFunctions), { CSSFormat: exports.find(m => m.RGBA) });

	const _reservedPanelIds = exports.find(m => m.BuddyFeed) as Record<string, number>;
	const Locale = exports.find(m => m.getTranslations);
	const createUrlLocale = findBy("has", "baseName", "language")(exportedFunctions);

	const imageAnalysis = findBy(/\![a-zA-Z_\$][\w\$]*\.isFallback|\{extractColor/)(exportedFunctions);
	const fallbackPreset = exports.find(m => m.colorDark);
	const extractColorPreset = async image => {
		const analysis = await imageAnalysis(Platform.getGraphQLLoader(), image);
		for (const result of analysis) {
			if ("isFallback" in result === false) {
				result.isFallback = fallbackPreset === result; // Why ?
			}
		}

		return analysis;
	};

	const getPlayContext = findBy("referrerIdentifier", "usePlayContextItem")(exportedFunctions);

	const InternalPropetyMap = exports.find(o => o.Builder);

	return {
		webpack,
		ReactRouter: exposeReactRouter(webpack),
		...exposeReact(webpack),
		ReactFlipToolkit: exposeReactFlipToolkit(webpack),
		getPlayContext,
		useContextMenuState,
		...exposeClassnames(webpack),
		Color,
		ReactComponents: exposeReactComponents(webpack, React, Platform),
		SpotifyReactHooks: exposeSpotifyReactHooks(webpack),
		SpotifyReactContexts: exposeSpotifyReactContexts(webpack),
		ReactQuery: exposeReactQuery(webpack),
		...exposeSnackbar(webpack),
		_reservedPanelIds,
		...exposeMousetrap(webpack),
		Locale,
		createUrlLocale,
		Snackbar: Object.assign(Snackbar, exposeSnackbar(webpack)),
		URI: exposeURI(webpack),
		extractColorPreset,
		InternalPropetyMap,
	};
}
