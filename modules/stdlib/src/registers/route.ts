/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mixin.ts";
import { Registry } from "./registry.ts";

const registry = new Registry<React.ReactNode>();
export default registry;

declare global {
	var __renderRoutes: any;
}

globalThis.__renderRoutes = () => registry.all();
transformer(
	emit => str => {
		str = str.replace(
			/(\(0,[a-zA-Z_\$][\w\$]*\.jsx\)\([a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*,\{[^\{]*path:"\/search\/\*")/,
			"...__renderRoutes(),$1",
		);
		emit();
		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);
