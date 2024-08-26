/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exports } from "./index.ts";

import type ReactDOMT from "npm:@types/react-dom";
import type ReactDOMServerT from "npm:@types/react-dom/server";

await CHUNKS.xpui.promise;

export const ReactJSX: any = exports.find((m) => m.jsx)!;
export const ReactDOM: typeof ReactDOMT = exports.find((m) => m.createRoot)!;
export const ReactDOMServer: typeof ReactDOMServerT = exports.find((m) => m.renderToString)!;
