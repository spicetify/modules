/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mix.ts";
import { Registry } from "./registry.ts";
import { React } from "../expose/React.ts";

type Refresh = PromiseWithResolvers<() => void> & {
	value: (() => void) | undefined;
};

class RootRegistry extends Registry<React.ReactNode> {
	refresh = Object.assign(Promise.withResolvers<() => void>(), {
		value: undefined as (() => void) | undefined,
	});

	static queueRefresh(refresh: Refresh) {
		if (refresh.value) {
			refresh.value();
		} else {
			refresh.promise.then((value) => value());
		}
	}

	override add(value: React.ReactNode): this {
		const ret = super.add(value);
		RootRegistry.queueRefresh(this.refresh);
		return ret;
	}

	override delete(value: React.ReactNode): boolean {
		const ret = super.delete(value);
		RootRegistry.queueRefresh(this.refresh);
		return ret;
	}
}

const childrenRegistry = new RootRegistry();
const providersRegistry = new RootRegistry();
export default [childrenRegistry, providersRegistry];

declare global {
	var __renderRootChildren: () => React.ReactNode;
	var __renderRootProviders: (providers: React.ReactElement[]) => React.ReactNode;
}
globalThis.__renderRootChildren = () =>
	React.createElement(() => {
		const [, refresh] = React.useReducer((n) => n + 1, 0);
		if (!childrenRegistry.refresh.value) {
			childrenRegistry.refresh.resolve(refresh);
		}
		childrenRegistry.refresh.value = refresh;
		return childrenRegistry.all();
	});
globalThis.__renderRootProviders = (providers: React.ReactElement[]) => {
	const MultiProvider = ({ children }) => {
		const [, refresh] = React.useReducer((n) => n + 1, 0);
		if (!providersRegistry.refresh.value) {
			providersRegistry.refresh.resolve(refresh);
		}
		providersRegistry.refresh.value = refresh;
		const providers = providersRegistry.all() as React.ReactElement[];
		return providers.reduceRight((acc: React.ReactElement, e: React.ReactElement) => React.cloneElement(e, undefined, acc), React.createElement(React.Fragment, undefined, children));
	};

	return React.useMemo(() => [providers, React.createElement(MultiProvider)].flat(), [providers]);
};
transformer(
	(emit) => (str) => {
		str = str.replace(
			/\bproviders:([a-zA-Z_\$][\w\$]*),children:\[([^\]]+"data-testid.:.root")/,
			"providers:__renderRootProviders($1),children:[__renderRootChildren(),$2",
		);
		emit();
		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);
