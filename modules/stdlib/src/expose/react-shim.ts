/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// npm-style `import ... from "react"` in module code resolves here (the kit
// build externalizes it to this runtime URL), so every module shares the
// client's React instance — hooks, context, and Component identity all match
// the renderer. The jsx runtime is stdlib-local too (./jsx-runtime.ts), so a
// built module's boot never depends on the network.
//
// Live bindings, not init-time snapshots: a `const X = R.X` taken while this
// file evaluates freezes whatever the lazy proxy returned at that moment —
// undefined, whenever anything evaluates the shim before the webpack capture
// (the Fragment bug, at 33x the blast radius). `export let` populated by the
// capture callback keeps the bindings live: consumers evaluate post-capture
// (the loader gates module loads on webpackLoaded) and read real values.

import { warn } from "../logger.ts";
import { onWebpackCaptured } from "../webpack/index.ts";
import { onFallbackRecovery, React } from "./React.ts";

const R = React as any;

export default React;

export let Children: any;
export let Component: any;
export let Fragment: any;
export let Profiler: any;
export let PureComponent: any;
export let StrictMode: any;
export let Suspense: any;
export let cloneElement: any;
export let createContext: any;
export let createElement: any;
export let createFactory: any;
export let createRef: any;
export let forwardRef: any;
export let isValidElement: any;
export let lazy: any;
export let memo: any;
export let startTransition: any;
export let useCallback: any;
export let useContext: any;
export let useDebugValue: any;
export let useDeferredValue: any;
export let useEffect: any;
export let useId: any;
export let useImperativeHandle: any;
export let useInsertionEffect: any;
export let useLayoutEffect: any;
export let useMemo: any;
export let useReducer: any;
export let useRef: any;
export let useState: any;
export let useSyncExternalStore: any;
export let useTransition: any;
export let version: any;

// Capture health (D3): a populate that comes up empty means the React
// needle missed the capture — the silent needle-drift failure after a client
// update. Say so where the manager can show it, and re-populate when the
// esm.sh fallback lands (L2) so named imports degrade to the fallback copy
// instead of staying frozen undefined.
function populate() {
	Children = R.Children;
	Component = R.Component;
	Fragment = R.Fragment;
	Profiler = R.Profiler;
	PureComponent = R.PureComponent;
	StrictMode = R.StrictMode;
	Suspense = R.Suspense;
	cloneElement = R.cloneElement;
	createContext = R.createContext;
	createElement = R.createElement;
	createFactory = R.createFactory;
	createRef = R.createRef;
	forwardRef = R.forwardRef;
	isValidElement = R.isValidElement;
	lazy = R.lazy;
	memo = R.memo;
	startTransition = R.startTransition;
	useCallback = R.useCallback;
	useContext = R.useContext;
	useDebugValue = R.useDebugValue;
	useDeferredValue = R.useDeferredValue;
	useEffect = R.useEffect;
	useId = R.useId;
	useImperativeHandle = R.useImperativeHandle;
	useInsertionEffect = R.useInsertionEffect;
	useLayoutEffect = R.useLayoutEffect;
	useMemo = R.useMemo;
	useReducer = R.useReducer;
	useRef = R.useRef;
	useState = R.useState;
	useSyncExternalStore = R.useSyncExternalStore;
	useTransition = R.useTransition;
	version = R.version;
}

onWebpackCaptured(() => {
	populate();
	if (typeof createElement !== "function") {
		warn(
			"[stdlib] capture health: the client React was not found in the webpack capture — " +
				"named `react` imports are degraded until the fallback loads (needle drift after a Spotify update?)",
		);
		onFallbackRecovery(() => {
			populate();
			if (typeof createElement === "function") {
				warn("[stdlib] capture health: named `react` imports recovered via the fallback copy");
			}
		});
	}
});
