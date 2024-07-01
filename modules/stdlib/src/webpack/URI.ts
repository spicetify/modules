/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ParsableAsURI = any;

export type IsThisURIType<A extends keyof URITypes> = (url: ParsableAsURI) => url is URIClass<A>;

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

export * from "./URI.gen.ts";
