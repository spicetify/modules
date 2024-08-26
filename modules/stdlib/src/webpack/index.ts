/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare global {
	var webpackChunkclient_web: any;
}

type WebpackRequire = any;
type WebpackChunk = any;
type WebpackModule = any;

export let require: WebpackRequire;
export let modules: Array<[string, WebpackChunk]>;
export let exports: Array<WebpackModule>;
export let exported: Array<any>;

export let exportedFunctions: Array<Function>;

export let exportedReactObjects: Partial<Record<any, any[]>>;
export let exportedContexts: Array<React.Context<any>>;
export let exportedForwardRefs: Array<React.ForwardRefExoticComponent<any>>;
export let exportedMemos: React.NamedExoticComponent[];

export const analyzeWebpackRequire = (require: WebpackRequire) => {
	const modules = Object.entries(require.m) as Array<[string, WebpackChunk]>;
	const exports = modules.map(([id]) => require(id)) as Array<WebpackModule>;
	const exported = exports
		.filter((module) => typeof module === "object")
		.flatMap((module) => {
			try {
				return Object.values(module);
			} catch (_) {}
		})
		.filter(Boolean) as Array<any>;

	const isFunction = (obj: any): obj is Function => typeof obj === "function";
	const exportedFunctions = exported.filter(isFunction);

	const exportedReactObjects = Object.groupBy(exported, (x) => x.$$typeof);
	const exportedContexts = exportedReactObjects[Symbol.for("react.context") as any]! as Array<
		React.Context<any>
	>;
	const exportedForwardRefs = exportedReactObjects[Symbol.for("react.forward_ref") as any]! as Array<
		React.ForwardRefExoticComponent<any>
	>;
	const exportedMemos = exportedReactObjects[Symbol.for("react.memo") as any]! as React.NamedExoticComponent[];

	return {
		modules,
		exports,
		exported,
		exportedFunctions,
		exportedReactObjects,
		exportedContexts,
		exportedForwardRefs,
		exportedMemos,
	};
};

CHUNKS["/vendor~xpui.js"] ??= Promise.withResolvers();
CHUNKS["/xpui.js"] ??= Promise.withResolvers();
Object.assign(CHUNKS, {
	xpui: {
		promise: Promise.all([CHUNKS["/vendor~xpui.js"].promise, CHUNKS["/xpui.js"].promise]) as any,
	},
});

CHUNKS.xpui.promise.then(() => {
	require = globalThis.webpackChunkclient_web.push([[Symbol()], {}, (re: any) => re]);
	const analysis = analyzeWebpackRequire(require);
	modules = analysis.modules;
	exports = analysis.exports;
	exported = analysis.exported;
	exportedFunctions = analysis.exportedFunctions;
	exportedReactObjects = analysis.exportedReactObjects;
	exportedContexts = analysis.exportedContexts;
	exportedForwardRefs = analysis.exportedForwardRefs;
	exportedMemos = analysis.exportedMemos;
});
