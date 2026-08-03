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

export const Fragment = React.Fragment;

// The automatic runtime passes children inside props and the key as a third
// argument; createElement wants the key in props. jsx/jsxs differ only in a
// static-children guarantee createElement doesn't care about.
function create(type: unknown, props: Record<string, unknown> | null, key?: unknown) {
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
