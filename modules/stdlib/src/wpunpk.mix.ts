/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type WebpackRequire = {
	m: Chunk[1];
	g: typeof globalThis;
};

export type Module = Function;
export type Modules = Record<keyof any, Module>;
export type Chunk = [
	Array<keyof any>,
	Modules,
	(wpr: WebpackRequire) => void,
];

export let webpackRequire: WebpackRequire;

export let postWebpackRequireHooks = new Array<(wpr: WebpackRequire) => void>();

declare global {
	var __webpack_require__: WebpackRequire;
	var webpackChunkclient_web: Chunk[];
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
] as Chunk];

globalThis.webpackChunkclient_web = webpackChunkclient_web;
