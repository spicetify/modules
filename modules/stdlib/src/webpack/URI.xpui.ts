/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { toPascalCase } from "/hooks/std/text.ts";
import { warn } from "../logger.ts";
import { modules, src } from "./index.ts";
import { webpackRequire } from "../wpunpk.mix.ts";
import { IsThisURIType, ParsableAsURI, URIClass, URITypes } from "./URI.ts";

type Is = {
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
	PlaylistV1OrV2: IsThisURIType<any>;
	Profile: IsThisURIType<any>;
	Radio: IsThisURIType<any>;
	Show: IsThisURIType<any>;
	SocialSession: IsThisURIType<any>;
	Station: IsThisURIType<any>;
	Track: IsThisURIType<any>;
};

type Create = {
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

await CHUNKS.xpui.promise;

// Needle misses are version drift, not fatal errors: a miss costs the
// affected surface member (undefined), never the whole module — a throw
// here rejects the lazy URI.gen import and used to crash the client.
const URIModuleHit = modules.find(
	([id, v]) => src(v).includes("Invalid Spotify URI!") && Object.keys(webpackRequire(id) ?? {}).length > 10,
);
if (!URIModuleHit) warn("[stdlib] webpack needle miss: URI module (Invalid Spotify URI!)");
const URIModule = URIModuleHit ? webpackRequire(URIModuleHit[0]) : {};
const [_Types, ...vs] = Object.values(URIModule) as [URITypes, ...Function[]];
export const Types = _Types ?? ({} as URITypes);
const TypesKeys = Object.keys(Types);

const isTestFn = (fn: Function) => TypesKeys.some((t) => src(fn).includes(`${t}}`));
const isCreateFn = (fn: Function) => TypesKeys.some((t) => src(fn).includes(`${t},`));

const fnsByType = Object.groupBy(vs, (fn) => (isTestFn(fn) ? "test" : isCreateFn(fn) ? "create" : undefined!));
export const is: Is = Object.fromEntries(
	(fnsByType.test ?? []).flatMap((fn) => {
		const name = src(fn).match(/([\w_\d]{2,})\}/)?.[1];
		return name ? [[toPascalCase(name), fn]] : [];
	}),
) as any;
export const create: Create = Object.fromEntries(
	(fnsByType.create ?? []).flatMap((fn) => {
		const name = src(fn).match(/([\w_\d]{2,})\,/)?.[1];
		return name ? [[toPascalCase(name), fn]] : [];
	}),
) as any;
const uniqueFns = fnsByType[undefined as unknown as keyof typeof fnsByType] ?? [];

const findAndExcludeBy = (...strings: string[]) => {
	const i = uniqueFns.findIndex((f) => strings.every((str) => src(f).includes(str)));
	if (i < 0) {
		warn("[stdlib] webpack needle miss: URI helper", strings.join(" + "));
		return undefined;
	}
	return uniqueFns.splice(i, 1)[0];
};

export const isSameIdentity: (a: ParsableAsURI, b: ParsableAsURI) => boolean = findAndExcludeBy("PLAYLIST") as any;
export const urlEncode: (str: string) => string = findAndExcludeBy(".URI") as any;
export const idToHex: (str: string) => string = findAndExcludeBy("22===") as any;
export const hexToId: (str: string) => string = findAndExcludeBy("32===") as any;
export const from: (uri: ParsableAsURI) => URIClass<any> = findAndExcludeBy("allowedTypes") as any;
export const fromString: (str: string) => URIClass<any> = findAndExcludeBy("Argument `uri` must be a string.") as any;

is.PlaylistV1OrV2 = (
	is.Playlist && is.PlaylistV2
		? findAndExcludeBy(`${(is.Playlist as Function).name}(e)||${(is.PlaylistV2 as Function).name}(e)`)
		: undefined
) as any;
