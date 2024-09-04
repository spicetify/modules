/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { hotwired, MixinContext } from "/hooks/module.ts";
import type { Transformer } from "/hooks/transform.ts";

// allows us to patch webpack module exports directly
const nativeObjectDefineProperty = Object.defineProperty;
Object.defineProperty = function (obj, prop, descriptor) {
	prop !== "prototype" && descriptor && (descriptor.configurable ??= true);
	return nativeObjectDefineProperty(obj, prop, descriptor);
};

const { promise, transformer } = await hotwired<MixinContext>(import.meta);
export { transformer };

promise.wrap(
	(async () => {
		await Promise.all([
			import("./src/expose/index.ts"),
			import("./src/registers/index.ts"),
			import("./src/events.mix.ts"),
			import("./src/wpunpk.mix.ts"),
		]);
	})(),
);
