/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { chunks, require } from "./index.ts";
import { findBy } from "/hooks/util.ts";

await CHUNKS.xpui.promise;

const [ReactRouterModuleID] = chunks.find(([_, v]) => v.toString().includes("React Router"))!;
const ReactRouterModule = Object.values(require(ReactRouterModuleID));

// https://github.com/remix-run/react-router/blob/main/packages/react-router/lib/hooks.tsx#L131
export const useMatch: Function = ReactRouterModule.find((f) =>
	f.toString().includes("let{pathname:") && !f.toString().includes(".createElement(")
);
