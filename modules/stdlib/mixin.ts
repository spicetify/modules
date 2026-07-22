/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// allows us to patch webpack module exports directly
const nativeObjectDefineProperty = Object.defineProperty;
Object.defineProperty = function (obj, prop, descriptor) {
	prop !== "prototype" && descriptor && (descriptor.configurable ??= true);
	return nativeObjectDefineProperty(obj, prop, descriptor);
};

export let transformer: unknown;

export default async function (t: unknown, _ctx: { spotifyVersion: string }) {
	transformer = t;
	await Promise.all([
		import("./src/expose/index.js"),
		import("./src/registers/index.js"),
		import("./src/events.mix.js"),
		import("./src/wpunpk.mix.js"),
	]);
}
