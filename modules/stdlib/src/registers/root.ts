/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { matchLast } from "/hooks/util.ts";
import { transformer } from "../../mixin.ts";
import { Registry } from "./registry.ts";
import { React } from "../expose/React.ts";

const registry = new (class extends Registry<React.ReactNode> {
	override add(value: React.ReactNode): this {
		const ret = super.add(value);
		queueRefresh();
		return ret;
	}

	override delete(value: React.ReactNode): boolean {
		const ret = super.delete(value);
		queueRefresh();
		return ret;
	}
})();
export default registry;

function queueRefresh() {
	if (refreshRoot.value) {
		refreshRoot.value();
	} else {
		refreshRoot.promise.then(value => value());
	}
}

const refreshRoot = Object.assign(Promise.withResolvers<() => void>(), { value: undefined as (() => void) | undefined });

declare global {
	var __renderRootChildren: any;
}
globalThis.__renderRootChildren = () => React.createElement(() => {
	const [, refresh] = React.useReducer(n => n + 1, 0);
	if (!refreshRoot.value) {
		refreshRoot.resolve(refresh);
	}
	refreshRoot.value = refresh;
	return registry.all();
});
transformer(
	emit => str => {
		str = str.replace(/children:\[([^\]]+"data-testid.:.root")/, "children:[__renderRootChildren(),$1");
		emit();
		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);
