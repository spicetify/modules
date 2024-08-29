/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export * from "./src/registers/index.ts";
export * from "./src/events.ts";
export * from "./src/storage.ts";
export * from "./src/logger.ts";

export default async function () {
	const { startEventHandlers } = await import("./src/events.ts");

	return startEventHandlers();
}
