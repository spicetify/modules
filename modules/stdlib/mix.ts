/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Transformer } from "/hooks/transform.ts";

const nativeObjectDefineProperty = Object.defineProperty;
Object.defineProperty = function (obj, prop, descriptor) {
	prop !== "prototype" && descriptor && (descriptor.configurable ??= true);
	return nativeObjectDefineProperty(obj, prop, descriptor);
};

export let transformer: Transformer;
export default async function (t: Transformer) {
	transformer = t;
	await Promise.all([
		import("./src/expose/index.ts"),
		import("./src/registers/index.ts"),
		import("./src/events.mix.ts"),
		import("./src/wpunpk.mix.ts"),
	]);
}
