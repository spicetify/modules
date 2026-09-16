import assert from "node:assert/strict";
import { test } from "node:test";
import { configureLyricsClient, getLyricsResponse, requestLyrics } from "./runtime-client.ts";

test("unloading cancels non-abortable Cosmos waits and prevents follow-up requests", async () => {
	const lifecycle = new AbortController();
	let calls = 0;
	configureLyricsClient(
		{
			cosmos: {
				get: async () => {
					calls++;
					return {};
				},
			},
		},
		lifecycle.signal,
	);
	const pending = requestLyrics(() => new Promise<never>(() => {}));
	const rejected = assert.rejects(pending, { name: "AbortError" });
	lifecycle.abort();
	await rejected;
	await assert.rejects(
		requestLyrics(async () => {
			calls++;
		}),
		{ name: "AbortError" },
	);
	assert.equal(calls, 0);
});

test("request timeout aborts fetch transport and frees the wait", async () => {
	configureLyricsClient({ cosmos: { get: async () => ({}) } });
	let transportSignal: AbortSignal | undefined;
	await assert.rejects(
		requestLyrics(
			(signal) => {
				transportSignal = signal;
				return new Promise<never>(() => {});
			},
			undefined,
			10,
		),
		{ name: "TimeoutError" },
	);
	assert.equal(transportSignal?.aborted, true);
});

test("query cancellation stays isolated from another request", async () => {
	configureLyricsClient({ cosmos: { get: async () => ({}) } });
	const query = new AbortController();
	const pending = requestLyrics(() => new Promise<never>(() => {}), query.signal);
	const rejected = assert.rejects(pending, { name: "AbortError" });
	query.abort();
	await rejected;
	assert.equal(await requestLyrics(async () => "other"), "other");
});

test("unloading after Cosmos dispatch rejects the wait and ignores a late response", async () => {
	const lifecycle = new AbortController();
	const dispatched = Promise.withResolvers<void>();
	const response = Promise.withResolvers<unknown>();
	let calls = 0;
	configureLyricsClient(
		{
			cosmos: {
				get: async () => {
					calls++;
					dispatched.resolve();
					return response.promise;
				},
			},
		},
		lifecycle.signal,
	);
	const pending = getLyricsResponse("sp://lyrics/test").then(() => getLyricsResponse("sp://lyrics/follow-up"));
	const rejected = assert.rejects(pending, { name: "AbortError" });
	await dispatched.promise;
	lifecycle.abort();
	await rejected;
	response.resolve({ body: "late" });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(calls, 1);
});
