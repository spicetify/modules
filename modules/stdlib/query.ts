/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { QueryClient } from "@tanstack/query-core";
import type { ModuleRuntimeContext } from "./mod.ts";

export { QueryClient, QueryObserver, isCancelledError } from "@tanstack/query-core";
export type { QueryKey, QueryFunctionContext } from "@tanstack/query-core";

/** A cache owned by one module load; unloading cancels queries and discards data. */
export function createModuleQueryClient(ctx: Pick<ModuleRuntimeContext, "defer">): QueryClient {
	const client = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 5 * 60 * 1000,
				gcTime: 10 * 60 * 1000,
				retry: false,
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
			},
			mutations: { retry: false },
		},
	});
	ctx.defer(async () => {
		await client.cancelQueries();
		client.clear();
	});
	return client;
}
