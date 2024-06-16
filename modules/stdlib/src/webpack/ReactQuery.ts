/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { chunks, exportedFunctions, modules, require } from "./index.ts";

import type {
	notifyManager as notifyManagerT,
	QueryClient as QueryClientT,
	QueryClientProvider as QueryClientProviderT,
	useInfiniteQuery as useInfiniteQueryT,
	useMutation as useMutationT,
	useQuery as useQueryT,
	useQueryClient as useQueryClientT,
	useSuspenseQuery as useSuspenseQueryT,
} from "npm:@tanstack/react-query";
import { findBy } from "/hooks/util.ts";

export type QueryClient = QueryClientT;
export type QueryClientProvider = typeof QueryClientProviderT;
export type notifyManager = typeof notifyManagerT;
export type useMutation = typeof useMutationT;
export type useQuery = typeof useQueryT;
export type useQueryClient = typeof useQueryClientT;
export type useSuspenseQuery = typeof useSuspenseQueryT;
export type useInfiniteQuery = typeof useInfiniteQueryT;

export let QueryClient: QueryClient;
export let PersistQueryClientProvider: Function;
export let QueryClientProvider: QueryClientProvider;
export let notifyManager: notifyManager;
export let useMutation: useMutation;
export let useQuery: useQuery;
export let useQueryClient: useQueryClient;
export let useSuspenseQuery: useSuspenseQuery;
export let useInfiniteQuery: useInfiniteQuery;

CHUNKS.xpui.promise.then(() => {
	QueryClient = findBy("defaultMutationOptions")(exportedFunctions) as unknown as QueryClient;
	PersistQueryClientProvider = findBy("persistOptions")(exportedFunctions);
	QueryClientProvider = findBy("use QueryClientProvider")(exportedFunctions) as QueryClientProvider;
	notifyManager = modules.find((m) => m.setBatchNotifyFunction) as notifyManager;
	useMutation = findBy("mutateAsync")(exportedFunctions) as useMutation;
	useQuery = findBy(
		/^function [a-zA-Z_\$][\w\$]*\(([a-zA-Z_\$][\w\$]*),([a-zA-Z_\$][\w\$]*)\)\{return\(0,[a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*\)\(\1,[a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*,\2\)\}$/,
	)(exportedFunctions) as useQuery;
	useQueryClient = findBy("client", "Provider", "mount")(exportedFunctions) as useQueryClient;
	useSuspenseQuery = findBy(
		"throwOnError",
		"suspense",
		"enabled",
	)(exportedFunctions) as useSuspenseQuery;
	const [infiniteQueryChunkID] = chunks.find(
		([_, v]) => v.toString().includes("fetchPreviousPage") && v.toString().includes("getOptimisticResult"),
	)!;
	useInfiniteQuery = Object.values(require(infiniteQueryChunkID)).find(
		(m) => typeof m === "function",
	) as useInfiniteQuery;
});
