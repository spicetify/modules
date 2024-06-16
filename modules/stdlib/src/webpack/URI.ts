/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { chunks, require } from "./index.ts";
import { capitalize } from "../../deps.ts";

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

export let Types: URITypes;
export let isSameIdentity: (a: ParsableAsURI, b: ParsableAsURI) => boolean;
export let urlEncode: (str: string) => string;
export let idToHex: (str: string) => string;
export let hexToId: (str: string) => string;
export let from: (uri: ParsableAsURI) => URIClass<any>;
export let fromString: (str: string) => URIClass<any>;
export let is: {
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
export let create: {
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

CHUNKS.xpui.promise.then(() => {
	const [URIModuleID] = chunks.find(
		([id, v]) => v.toString().includes("Invalid Spotify URI!") && Object.keys(require(id)).length > 10,
	)!;
	const URIModule = require(URIModuleID);
	const [_Types, ...vs] = Object.values(URIModule) as [URITypes, ...Function[]];
	Types = _Types;
	const TypesKeys = Object.keys(Types);

	const isTestFn = (fn: Function) => TypesKeys.some((t) => fn.toString().includes(`${t}}`));
	const isCreateFn = (fn: Function) => TypesKeys.some((t) => fn.toString().includes(`${t},`));

	const CaseLikeThis = (s: string) => s.split("_").map(capitalize).join("");

	const fnsByType = Object.groupBy(vs, (fn) => isTestFn(fn) ? "test" : isCreateFn(fn) ? "create" : undefined!);
	is = Object.fromEntries(
		fnsByType.test!.map((fn) => [CaseLikeThis(fn.toString().match(/([\w_\d]{2,})\}/)![1]), fn]),
	) as any;
	create = Object.fromEntries(
		fnsByType.create!.map((fn) => [CaseLikeThis(fn.toString().match(/([\w_\d]{2,})\,/)![1]), fn]),
	) as any;
	const uniqueFns = fnsByType[undefined as unknown as keyof typeof fnsByType]!;

	const findAndExcludeBy = (...strings: string[]) => {
		const i = uniqueFns.findIndex((f) => strings.every((str) => f.toString().includes(str)));
		return uniqueFns.splice(i, 1)[0];
	};

	isSameIdentity = findAndExcludeBy("PLAYLIST") as any;
	urlEncode = findAndExcludeBy(".URI") as any;
	idToHex = findAndExcludeBy("22===") as any;
	hexToId = findAndExcludeBy("32===") as any;
	from = findAndExcludeBy("allowedTypes") as any;
	fromString = findAndExcludeBy("Argument `uri` must be a string.") as any;

	is.PlaylistV1OrV2 = findAndExcludeBy(`${is.Playlist.name}(e)||${is.PlaylistV2.name}(e)`) as any;
});
