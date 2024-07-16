/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Transformer } from "/hooks/index.ts";

const nativeObjectDefineProperty = Object.defineProperty;
Object.defineProperty = function (obj, prop, descriptor) {
	prop !== "prototype" && descriptor && (descriptor.configurable ??= true);
	return nativeObjectDefineProperty(obj, prop, descriptor);
};

export let transformer: Transformer;
export default async function (t: Transformer) {
	transformer = t;
	await import("./src/expose/index.js");
	await import("./src/registers/index.js");
}
