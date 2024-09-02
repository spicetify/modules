/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { WebpackModule, WebpackRequire, webpackRequire } from "../wpunpk.mix.ts";

export let modules: Array<[number, WebpackModule]>;
export let exports: Array<Record<string, any>>;
export let exported: Array<any>;

export let exportedFunctions: Array<Function>;

export let exportedReactObjects: Partial<Record<any, any[]>>;
export let exportedContexts: Array<React.Context<any>>;
export let exportedForwardRefs: Array<React.ForwardRefExoticComponent<any>>;
export let exportedMemos: React.NamedExoticComponent[];

export const analyzeWebpackRequire = (webpackRequire: WebpackRequire) => {
	const modules = Object.entries(webpackRequire.m) as Array<[keyof any, WebpackModule]>;
	const exports = modules.map(([id]) => webpackRequire(id)) as Array<Record<string, any>>;
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
	const analysis = analyzeWebpackRequire(webpackRequire);
	modules = analysis.modules;
	exports = analysis.exports;
	exported = analysis.exported;
	exportedFunctions = analysis.exportedFunctions;
	exportedReactObjects = analysis.exportedReactObjects;
	exportedContexts = analysis.exportedContexts;
	exportedForwardRefs = analysis.exportedForwardRefs;
	exportedMemos = analysis.exportedMemos;
});
