/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { modules } from "./index.ts";

import type MousetrapT from "npm:@types/mousetrap";

await CHUNKS.xpui.promise;

export const Mousetrap: typeof MousetrapT = modules.find((m) => m.addKeycodes);
