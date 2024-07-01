/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exportedContexts } from "./index.ts";

await CHUNKS.xpui.promise;

export const FilterContext = exportedContexts.find((c) => (c as any)._currentValue2?.setFilter)!;
