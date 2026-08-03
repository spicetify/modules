/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findBy } from "../util.ts";
import { exportedFunctions, modules, src } from "./index.ts";

import type { useLocation as useLocationT, useMatch as useMatchT } from "npm:react-router";
import { webpackRequire } from "../wpunpk.mix.ts";

await CHUNKS.xpui.promise;

const [ReactRouterModuleID] = modules.find(([_, v]) => v.toString().includes("React Router"))!;
const ReactRouterModule = Object.values(webpackRequire(ReactRouterModuleID));

// https://github.com/remix-run/react-router/blob/main/packages/react-router/lib/hooks.tsx#L131
export const useMatch: typeof useMatchT = ReactRouterModule.find(
	(f) => src(f).includes("let{pathname:") && !src(f).includes(".createElement("),
);

export const useLocation: typeof useLocationT = findBy("location", "useContext")(exportedFunctions);
