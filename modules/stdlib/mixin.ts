/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// allows us to patch webpack module exports directly
const nativeObjectDefineProperty = Object.defineProperty;
Object.defineProperty = function (obj, prop, descriptor) {
	if (prop !== "prototype" && descriptor) descriptor.configurable ??= true;
	return nativeObjectDefineProperty(obj, prop, descriptor);
};

// Shape of the loader-provided source transformer: registers a rewrite
// over client bundles matched by glob. emit() reports the needle matched
// (optionally with a captured value the returned promise resolves with).
export type Transformer = <T = unknown>(
	fn: (emit: (value?: T) => void) => (str: string) => string,
	opts?: { glob?: RegExp; wait?: boolean; noAwait?: boolean },
) => Promise<T>;

export let transformer: Transformer;

export default async function (t: Transformer, _ctx: { spotifyVersion: string }) {
	transformer = t;
	await Promise.all([
		import("./src/expose/index.js"),
		import("./src/registers/index.js"),
		import("./src/events.mix.js"),
		import("./src/wpunpk.mix.js"),
	]);
}
