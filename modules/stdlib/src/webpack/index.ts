/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { postWebpackRequireHooks, WebpackModule, WebpackRequire, webpackRequire } from "../wpunpk.mix.ts";

export let modules: Array<[number, WebpackModule]>;
export let exports: Array<Record<string, any>>;
export let exported: Array<any>;

export let exportedFunctions: Array<Function>;

export let exportedReactObjects: Partial<Record<any, any[]>>;
export let exportedContexts: Array<React.Context<any>>;
export let exportedForwardRefs: Array<React.ForwardRefExoticComponent<any>>;
export let exportedMemos: React.NamedExoticComponent[];

// Some client exports are functions whose own toString is not callable; they
// can never match a needle, so they stringify to "".
export const src = (f: unknown): string => {
	try {
		return String(f);
	} catch {
		try {
			return Function.prototype.toString.call(f);
		} catch {
			return "";
		}
	}
};

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

// v3 chunk tracking: the 2024 pre-boot mixin that resolved chunk promises is
// gone. The loader captures __webpack_require__ once the client is up, and
// the xpui entry chunks live in the V8 snapshot — they have necessarily
// executed by capture time. Lazy route chunks go through the runtime's own
// script loader (wpr.l) from then on.
postWebpackRequireHooks.push((wpr: any) => {
	if (typeof wpr?.l === "function") {
		const load = wpr.l.bind(wpr);
		wpr.l = (url: string, done: (event: unknown) => unknown, key?: string, chunkId?: unknown) =>
			load(
				url,
				(event: unknown) => {
					(CHUNKS[new URL(url, location.href).pathname] ??= Promise.withResolvers()).resolve(undefined);
					return done(event);
				},
				key,
				chunkId,
			);
	}
	// Chunk scripts that finished loading before capture. The xpui entry
	// chunks are deliberately excluded: they are gated below on registry
	// quiescence, because "script fetched" is not "all modules registered".
	for (const entry of performance.getEntriesByType("resource")) {
		const url = new URL(entry.name, location.href);
		if (url.pathname === "/vendor~xpui.js" || url.pathname === "/xpui.js") continue;
		if (url.origin === location.origin && url.pathname.endsWith(".js")) {
			(CHUNKS[url.pathname] ??= Promise.withResolvers()).resolve(undefined);
		}
	}
	// Capture can fire while boot is still registering modules (xpui-modules
	// and friends land after the runtime is up, and the analysis needles live
	// there). The analysis below snapshots wpr.m once, so hold the xpui
	// promises until the registry has been quiet for a few ticks — with a
	// hard cap so a pathological boot still resolves.
	let last = -1;
	let stable = 0;
	let ticks = 0;
	const settle = setInterval(() => {
		const count = Object.keys(wpr?.m ?? {}).length;
		stable = count === last ? stable + 1 : 0;
		last = count;
		if (stable >= 3 || ++ticks > 100) {
			clearInterval(settle);
			CHUNKS["/vendor~xpui.js"].resolve(undefined);
			CHUNKS["/xpui.js"].resolve(undefined);
		}
	}, 100);
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
