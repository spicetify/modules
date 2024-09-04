/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { hotwired, type LoadContext } from "/hooks/module.ts";

import { startEventHandlers } from "./src/events.ts";

const { promise } = await hotwired<LoadContext>(import.meta);

const cancelEventHandlers = startEventHandlers();

promise.resolve(() => {
	cancelEventHandlers();
});
