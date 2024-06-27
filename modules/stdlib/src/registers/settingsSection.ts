/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mix.ts";
import { Registry } from "./registry.ts";

const registry = new Registry<React.ReactNode>();
export default registry;

declare global {
	var __renderSettingSections: any;
}

globalThis.__renderSettingSections = () => registry.all();
transformer(
	emit => str => {
		str = str.replace(
			/(\(0,[a-zA-Z_\$][\w\$]*\.jsx\)\([a-zA-Z_\$][\w\$]*,{settings:[a-zA-Z_\$][\w\$]*,setValue:[a-zA-Z_\$][\w\$]*}\))]/,
			"$1,...__renderSettingSections()]",
		);

		emit();
		return str;
	},
	{
		noAwait: true,
		glob: /^\/xpui-routes-desktop-settings\.js/,
	},
);
