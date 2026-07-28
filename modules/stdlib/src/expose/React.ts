/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exports as webpackExports } from "../webpack/index.ts";

// @deno-types="npm:@types/react@18.3.1"
import _React from "https://esm.sh/react@18.3.1";
// @deno-types="npm:@types/react-dom@18.3.0"
import _ReactDOM from "https://esm.sh/react-dom@18.3.1";
// @deno-types="npm:@types/react-dom@18.3.0/server"
import _ReactDOMServer from "https://esm.sh/react-dom@18.3.1/server";

// One React rule: module trees mix stdlib chrome, module components, and
// client components, so hooks and context identity must resolve to the
// client's own React instance. The 2024 runtime unified the other way
// (pre-boot factory swap to the esm.sh copy); post-boot that is impossible,
// so the exposed React lazily forwards to the client instance once webpack
// is captured. The esm.sh copy only backs pre-capture access — element
// creation is instance-independent, and module hooks never run pre-capture.
const lazyInstance = <T extends object>(fallback: T, find: () => object | undefined): T => {
	let cached: object | undefined;
	return new Proxy(fallback, {
		get: (fb, key) => {
			cached ??= find();
			return ((cached ?? fb) as Record<PropertyKey, unknown>)[key];
		},
	}) as T;
};

type ReactModule = typeof import("react");
type ReactDOMModule = typeof import("react-dom") & typeof import("react-dom/client");

export const React: ReactModule = lazyInstance(_React as ReactModule, () =>
	webpackExports?.find(
		(m) =>
			m &&
			typeof m.createElement === "function" &&
			typeof m.useReducer === "function" &&
			typeof m.useEffect === "function",
	),
);
export const ReactDOM: ReactDOMModule = lazyInstance(_ReactDOM as ReactDOMModule, () =>
	webpackExports?.find((m) => m && typeof m.createRoot === "function" && typeof m.createPortal === "function"),
);
export const ReactDOMServer = _ReactDOMServer;
