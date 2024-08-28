/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export * from "./src/registers/index.ts";
export * from "./src/events.ts";
export * from "./src/storage.ts";
export * from "./src/logger.ts";

export default async function () {
	const { historyListener, playerListener } = await import("./src/events.ts");
	const { Platform } = await import("./src/expose/Platform.ts");
	const cancelPlayerListener = Platform.getPlayerAPI().getEvents().addListener("update", playerListener);
	const cancelHistoryListener = Platform.getHistory().listen(historyListener);
	return () => {
		cancelPlayerListener();
		cancelHistoryListener();
	};
}
