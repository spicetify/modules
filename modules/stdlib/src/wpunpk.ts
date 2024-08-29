/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { assertEquals } from "/hooks/std/assert.ts";

import { Subject } from "https://esm.sh/rxjs";

import { type Chunk, type Module, type Modules, webpackRequire } from "./wpunpk.mix.ts";

type ChunkModulesPair = [Chunk, Modules];
const chunkLoadedSubject = new Subject<ChunkModulesPair>();

function trap(fn: (chunk: Chunk) => void) {
	return (chunk: Chunk) => {
		const webpackRequire_m = webpackRequire.m;

		const newModules: Chunk[1] = {};

		webpackRequire.m = new Proxy(webpackRequire_m, {
			set(target, p, newValue, receiver) {
				const ok = Reflect.set(target, p, newValue, receiver);
				if (ok) {
					newModules[p] = newValue;
				}
				return ok;
			},
		});

		fn(chunk);

		webpackRequire.m = webpackRequire_m;

		chunkLoadedSubject.next([chunk, newModules]);
	};
}

// @ts-ignore
webpackChunkclient_web.forEach = (fn: (chunk: Chunk) => void) => {
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

type ModuleMatcher = (id: string, module: Module) => boolean;
type ModulePair = [keyof any, Module];

export function matchWebpackModule(
	moduleMatcher: ModuleMatcher,
	immediate: true,
): ModulePair | null;
export function matchWebpackModule(
	moduleMatcher: ModuleMatcher,
	immediate?: false,
): Promise<ModulePair>;
export function matchWebpackModule(
	moduleMatcher: ModuleMatcher,
	immediate = false,
): unknown {
	for (const [id, module] of Object.entries(webpackRequire!.m)) {
		if (moduleMatcher(id, module)) {
			return [id, module] as ModulePair;
		}
	}

	if (immediate) {
		return null;
	}

	const p = Promise.withResolvers<ModulePair>();

	const subscription = chunkLoadedSubject.subscribe(([chunk, modules]) => {
		for (const [id, module] of Object.entries(modules)) {
			if (moduleMatcher(id, module)) {
				subscription.unsubscribe();
				p.resolve([id, module] as ModulePair);
			}
		}
	});

	return p;
}
