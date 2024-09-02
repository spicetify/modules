/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { toPascalCase } from "/hooks/std/text.ts";
import { modules } from "./index.ts";
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

const [URIModuleID] = modules.find(
	([id, v]) => v.toString().includes("Invalid Spotify URI!") && Object.keys(webpackRequire(id)).length > 10,
)!;
const URIModule = webpackRequire(URIModuleID);
const [_Types, ...vs] = Object.values(URIModule) as [URITypes, ...Function[]];
export const Types = _Types;
const TypesKeys = Object.keys(Types);

const isTestFn = (fn: Function) => TypesKeys.some((t) => fn.toString().includes(`${t}}`));
const isCreateFn = (fn: Function) => TypesKeys.some((t) => fn.toString().includes(`${t},`));

const fnsByType = Object.groupBy(vs, (fn) => isTestFn(fn) ? "test" : isCreateFn(fn) ? "create" : undefined!);
export const is: Is = Object.fromEntries(
	fnsByType.test!.map((fn) => [toPascalCase(fn.toString().match(/([\w_\d]{2,})\}/)![1]), fn]),
) as any;
export const create: Create = Object.fromEntries(
	fnsByType.create!.map((fn) => [toPascalCase(fn.toString().match(/([\w_\d]{2,})\,/)![1]), fn]),
) as any;
const uniqueFns = fnsByType[undefined as unknown as keyof typeof fnsByType]!;

const findAndExcludeBy = (...strings: string[]) => {
	const i = uniqueFns.findIndex((f) => strings.every((str) => f.toString().includes(str)));
	return uniqueFns.splice(i, 1)[0];
};

export const isSameIdentity: (a: ParsableAsURI, b: ParsableAsURI) => boolean = findAndExcludeBy(
	"PLAYLIST",
) as any;
export const urlEncode: (str: string) => string = findAndExcludeBy(".URI") as any;
export const idToHex: (str: string) => string = findAndExcludeBy("22===") as any;
export const hexToId: (str: string) => string = findAndExcludeBy("32===") as any;
export const from: (uri: ParsableAsURI) => URIClass<any> = findAndExcludeBy("allowedTypes") as any;
export const fromString: (str: string) => URIClass<any> = findAndExcludeBy(
	"Argument `uri` must be a string.",
) as any;

is.PlaylistV1OrV2 = findAndExcludeBy(`${is.Playlist.name}(e)||${is.PlaylistV2.name}(e)`) as any;
