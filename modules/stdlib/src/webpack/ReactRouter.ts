/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { chunks, require } from "./index.ts";
import { findBy } from "/hooks/util.ts";

// https://github.com/remix-run/react-router/blob/main/packages/react-router/lib/hooks.tsx#L131
export let useMatch: Function;

CHUNKS.xpui.promise.then(() => {
	const [ReactRouterModuleID] = chunks.find(([_, v]) => v.toString().includes("React Router"))!;
	const ReactRouterModule = Object.values(require(ReactRouterModuleID));

	useMatch = findBy(
		"let{pathname:",
		/\(([a-zA-Z_\$][\w\$]*),([a-zA-Z_\$][\w\$]*)\)\),\[\2,\1\]/,
	)(ReactRouterModule) as Function;
});
