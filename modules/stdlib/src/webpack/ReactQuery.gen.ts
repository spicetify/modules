/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as ReactQuery_xpui_ts from "./ReactQuery.xpui.ts";
export let QueryClient: typeof ReactQuery_xpui_ts.QueryClient;
export let PersistQueryClientProvider: typeof ReactQuery_xpui_ts.PersistQueryClientProvider;
export let QueryClientProvider: typeof ReactQuery_xpui_ts.QueryClientProvider;
export let notifyManager: typeof ReactQuery_xpui_ts.notifyManager;
export let useMutation: typeof ReactQuery_xpui_ts.useMutation;
export let useQuery: typeof ReactQuery_xpui_ts.useQuery;
export let useQueryClient: typeof ReactQuery_xpui_ts.useQueryClient;
export let useSuspenseQuery: typeof ReactQuery_xpui_ts.useSuspenseQuery;
export let useInfiniteQuery: typeof ReactQuery_xpui_ts.useInfiniteQuery;
import("./ReactQuery.xpui.ts").then(m => {
	QueryClient = m.QueryClient;
	PersistQueryClientProvider = m.PersistQueryClientProvider;
	QueryClientProvider = m.QueryClientProvider;
	notifyManager = m.notifyManager;
	useMutation = m.useMutation;
	useQuery = m.useQuery;
	useQueryClient = m.useQueryClient;
	useSuspenseQuery = m.useSuspenseQuery;
	useInfiniteQuery = m.useInfiniteQuery;
});
