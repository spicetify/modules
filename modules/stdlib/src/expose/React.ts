/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exports as webpackExports } from "../webpack/index.ts";

// One React rule: module trees mix stdlib chrome, module components, and
// client components, so hooks and context identity must resolve to the
// client's own React instance. The 2024 runtime unified the other way
// (pre-boot factory swap to the esm.sh copy); post-boot that is impossible,
// so the exposed React lazily forwards to the client instance once webpack
// is captured.
//
// The esm.sh copy only backs pre-capture access — element creation is
// instance-independent, and module hooks never run pre-capture (the loader
// gates module loads on webpackLoaded). It therefore loads lazily, and only
// on an actual pre-capture miss: a static import here would put esm.sh in
// every client's boot path and make an offline boot fail the whole module
// graph.
const lazyFallback = (url: string, pick: (m: Record<string, unknown>) => object | undefined) => {
	let mod: object | undefined;
	let requested = false;
	return (): object | undefined => {
		if (!mod && !requested) {
			requested = true;
			void import(url)
				.then((m) => {
					mod = pick(m);
				})
				.catch(() => {
					/* offline: the client instance is the real path anyway */
				});
		}
		return mod;
	};
};

const lazyInstance = <T extends object>(find: () => object | undefined, fallback: () => object | undefined): T => {
	let cached: object | undefined;
	return new Proxy({} as T, {
		get: (_target, key) => {
			cached ??= find();
			return ((cached ?? fallback()) as Record<PropertyKey, unknown> | undefined)?.[key];
		},
	});
};

type ReactModule = typeof import("react");
type ReactDOMModule = typeof import("react-dom") & typeof import("react-dom/client");

export const React: ReactModule = lazyInstance(
	() =>
		webpackExports?.find(
			(m) =>
				m &&
				typeof m.createElement === "function" &&
				typeof m.useReducer === "function" &&
				typeof m.useEffect === "function",
		),
	lazyFallback("https://esm.sh/react@18.3.1", (m) => (m.default ?? m) as object),
);
export const ReactDOM: ReactDOMModule = lazyInstance(
	() => webpackExports?.find((m) => m && typeof m.createRoot === "function" && typeof m.createPortal === "function"),
	lazyFallback("https://esm.sh/react-dom@18.3.1", (m) => (m.default ?? m) as object),
);
// The client bundles its own react-dom/server (renderToString consumers);
// forward to it, esm.sh only as the same lazy last resort.
export const ReactDOMServer: typeof import("react-dom/server") = lazyInstance(
	() => webpackExports?.find((m) => m && typeof m.renderToString === "function"),
	lazyFallback("https://esm.sh/react-dom@18.3.1/server", (m) => (m.default ?? m) as object),
);
