import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { client, type ClientCapabilities } from "./client.ts";

// This function is compiled, never run: unknown results must be parsed by callers.
async function checkContract(cosmos: ClientCapabilities["cosmos"]) {
	for (const method of ["get", "post", "put", "del", "patch"] as const) {
		const body = await cosmos[method]("sp://test", { nested: { enabled: true } }, { accept: "application/json" });
		// @ts-expect-error Cosmos payloads are unvalidated.
		void body.message;
	}
	for (const method of ["request", "resolve"] as const) {
		const response = await cosmos[method]("GET", "sp://test");
		// @ts-expect-error Response envelopes must not reintroduce any payloads.
		void response.body.message;
	}
	await cosmos.sub("sp://test", (event) => {
		// @ts-expect-error Subscription events are unvalidated.
		void event.message;
	});
	await cosmos.postSub("sp://test", null, (event) => {
		// @ts-expect-error Subscription events are unvalidated.
		void event.message;
	});
	// @ts-expect-error Cosmos has no generic escape hatch for unchecked responses.
	await cosmos.get<{ message: string }>("sp://test");
}
void checkContract;

const originalRuntime = Object.getOwnPropertyDescriptor(globalThis, "Spicetify");
afterEach(() => {
	if (originalRuntime) Object.defineProperty(globalThis, "Spicetify", originalRuntime);
	else Reflect.deleteProperty(globalThis, "Spicetify");
});

test("Cosmos preserves the current runtime object, receiver, arguments and response", async () => {
	const payload = { nested: { enabled: true } };
	const headers = { accept: "application/json" };
	const response = { message: { body: { token: "test" } } };
	const cosmos = {
		get(url: string, body?: unknown, requestHeaders?: unknown) {
			assert.equal(this, cosmos);
			assert.equal(url, "sp://test");
			assert.equal(body, payload);
			assert.equal(requestHeaders, headers);
			return Promise.resolve(response);
		},
	};
	Object.defineProperty(globalThis, "Spicetify", { configurable: true, value: { CosmosAsync: cosmos } });
	assert.equal(client.cosmos, cosmos);
	assert.equal(await client.cosmos.get("sp://test", payload, headers), response);
	const replacement = { get: () => Promise.resolve(null) };
	Object.defineProperty(globalThis, "Spicetify", { configurable: true, value: { CosmosAsync: replacement } });
	assert.equal(client.cosmos, replacement);
});
