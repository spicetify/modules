/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type WebpackRequire = {
	(id: keyof any): any;
	m: WebpackChunk[1];
	g: typeof globalThis;
};

export type WebpackModule = <This extends {}>(
	this: This,
	module: { id: keyof any; loaded: false; exports: This },
	exports: This,
	require: WebpackRequire,
) => void;
export type WebpackModules = Record<keyof any, WebpackModule>;
export type WebpackChunk = [
	Array<keyof any>,
	WebpackModules,
	(wpr: WebpackRequire) => void,
];

export let webpackRequire: WebpackRequire;

export let postWebpackRequireHooks = new Array<(wpr: WebpackRequire) => void>();

declare global {
	var __webpack_require__: WebpackRequire;
	var webpackChunkclient_web: WebpackChunk[];
}

const webpackChunkclient_web = [[
	[Symbol.for("spicetify.webpack.chunk.id")],
	{},
	($: WebpackRequire) => {
		globalThis["__webpack_require__"] = webpackRequire = $;
		for (const hook of postWebpackRequireHooks) {
			hook($);
		}
		// @ts-ignore
		postWebpackRequireHooks = undefined;
	},
] as WebpackChunk];

globalThis.webpackChunkclient_web = webpackChunkclient_web;

//

import { assertEquals } from "/hooks/std/assert.ts";

import { Subject } from "https://esm.sh/rxjs";

type ChunkModulesPair = [WebpackChunk, WebpackModules];
export const chunkLoadedSubjectPre = new Subject<WebpackChunk>();
export const moduleLoadedSubject = new Subject<[typeof any, WebpackModule]>();
export const chunkLoadedSubjectPost = new Subject<ChunkModulesPair>();

function trap(fn: (chunk: WebpackChunk) => void) {
	return (chunk: WebpackChunk) => {
		chunkLoadedSubjectPre.next(chunk);

		const webpackRequire_m = webpackRequire.m;

		const newModules: WebpackChunk[1] = {};

		webpackRequire.m = new Proxy(webpackRequire_m, {
			set(target, p, newValue, receiver) {
				const ok = Reflect.set(target, p, newValue, receiver);
				if (ok) {
					newModules[p] = newValue;
					moduleLoadedSubject.next([p, newValue]);
				}
				return ok;
			},
		});

		fn(chunk);

		webpackRequire.m = webpackRequire_m;

		chunkLoadedSubjectPost.next([chunk, newModules]);
	};
}

// @ts-ignore
webpackChunkclient_web.forEach = (fn: (chunk: WebpackChunk) => void) => {
	const trappedFn = trap(fn);

	Array.prototype.forEach.call(webpackChunkclient_web, (chunk, index) => {
		if (index === 0) {
			assertEquals(chunk[0], [Symbol.for("spicetify.webpack.chunk.id")]);

			fn(chunk);

			return;
		}

		trappedFn(chunk);
	});
};

globalThis.webpackChunkclient_web = new Proxy(webpackChunkclient_web, {
	set(target, p, newValue, receiver) {
		if (p !== "push") {
			return Reflect.set(target, p, newValue, receiver);
		}

		const push = function () {
			const args = Array.prototype.slice.call(arguments);
			for (const chunk of args) {
				trap(newValue)(chunk);
			}
		};

		return Reflect.set(target, p, push, receiver);
	},
});
