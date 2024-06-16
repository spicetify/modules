/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exportedContexts } from "./index.ts";

export let FilterContext: React.Context<any>;

CHUNKS.xpui.promise.then(() => {
	FilterContext = exportedContexts.find((c) => (c as any)._currentValue2?.setFilter)!;
});
