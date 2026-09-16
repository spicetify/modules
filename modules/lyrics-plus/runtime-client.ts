/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ClientCapabilities } from "/modules/stdlib/mod.ts";

type LyricsClient = {
	readonly cosmos: Pick<ClientCapabilities["cosmos"], "get">;
};

let configuredClient: LyricsClient | undefined;
let lifetime: AbortSignal | undefined;

export function configureLyricsClient(client: LyricsClient, signal?: AbortSignal): void {
	configuredClient = client;
	lifetime = signal;
}

/** Cosmos cannot abort its transport; stop waiting and prevent subsequent provider work. */
export function requestLyrics<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	signal?: AbortSignal,
	timeoutMs = 15_000,
): Promise<T> {
	const timeout = new AbortController();
	const signals = [timeout.signal];
	if (lifetime) signals.push(lifetime);
	if (signal) signals.push(signal);
	const combined = AbortSignal.any(signals);
	return new Promise<T>((resolve, reject) => {
		if (combined.aborted) {
			reject(combined.reason);
			return;
		}
		const timer = setTimeout(
			() => timeout.abort(new DOMException("Lyrics request timed out", "TimeoutError")),
			timeoutMs,
		);
		const cleanup = () => {
			clearTimeout(timer);
			combined.removeEventListener("abort", abort);
		};
		const abort = () => {
			cleanup();
			reject(combined.reason);
		};
		combined.addEventListener("abort", abort, { once: true });
		Promise.resolve()
			.then(() => {
				combined.throwIfAborted();
				return operation(combined);
			})
			.then(
				(value) => {
					cleanup();
					resolve(value);
				},
				(error: unknown) => {
					cleanup();
					reject(error);
				},
			);
	});
}

export function getLyricsResponse(
	url: string,
	signal?: AbortSignal,
	body?: Parameters<LyricsClient["cosmos"]["get"]>[1],
	headers?: Parameters<LyricsClient["cosmos"]["get"]>[2],
): Promise<unknown> {
	const client = configuredClient;
	if (!client) return Promise.reject(new Error("Lyrics Plus client is not configured"));
	return requestLyrics(() => client.cosmos.get(url, body, headers), signal);
}
