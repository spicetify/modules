/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Automatic-runtime JSX backed by the captured client React. The kit build
// aliases "react/jsx-runtime" here so a module's boot never depends on the
// network (the esm.sh runtime it replaces was a static import in every
// built .tsx module). Element creation must go through the client instance
// anyway — one React rule.

import { React } from "./React.ts";

// A stable local sentinel rather than a snapshot of React.Fragment: this
// module can be evaluated before the webpack capture completes (a mixin or
// any early importer is enough), and a `const Fragment = React.Fragment`
// taken at that moment freezes undefined forever — after which every
// fragment in every module renders as React error #130 and the route
// overlay shows a blank page. All fragment usage flows through jsx/jsxs
// below, so the sentinel is swapped for the real React.Fragment at call
// time, when the capture is live.
export const Fragment: unknown = Symbol.for("spicetify.jsx.Fragment");

// The automatic runtime passes children inside props and the key as a third
// argument; createElement wants the key in props. jsx/jsxs differ only in a
// static-children guarantee createElement doesn't care about.
function create(type: unknown, props: Record<string, unknown> | null, key?: unknown) {
	if (type === Fragment) type = React.Fragment;
	const { children, ...rest } = props ?? {};
	if (key !== undefined) (rest as Record<string, unknown>).key = key;
	const ce = React.createElement as (...args: unknown[]) => unknown;
	return Array.isArray(children)
		? ce(type, rest, ...children)
		: children !== undefined
			? ce(type, rest, children)
			: ce(type, rest);
}

export const jsx = create;
export const jsxs = create;
export const jsxDEV = create;
