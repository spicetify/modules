/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The extractor normally walks the live client, but its graph walk and
// emitter are pure over any object, so a synthetic Platform proves the
// port: shapes are observed, safe getters probed, listener-shaped methods
// fed noop callbacks, and hand-written METHOD_TYPES win over probing.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { METHOD_TYPES, type MethodType, TypeGenerator } from "./platform-typegen.ts";

const generate = async (root: unknown, methodTypes: readonly MethodType[] = []) => {
	const generator = new TypeGenerator(root, "Platform", methodTypes);
	return { output: await generator.generate(), stats: generator.stats };
};

describe("TypeGenerator over a synthetic Platform", () => {
	it("emits an interface for the root with observed property types", async () => {
		const { output } = await generate({
			version: "1.2.96.181",
			container: "desktop",
			enableCastConnect: true,
		});
		assert.match(output, /export interface Platform \{/);
		assert.match(output, /version: string;/);
		assert.match(output, /enableCastConnect: boolean;/);
		assert.match(output, /on Spotify Version: 1\.2\.96\.181/);
	});

	it("probes get*() methods and types what they return", async () => {
		const { output, stats } = await generate({
			getSessionAPI: () => ({
				getCount: () => 3,
				isReady: true,
			}),
		});
		assert.match(output, /getSessionAPI: /);
		assert.match(output, /getCount: /);
		assert.ok(stats.invocations >= 2, "both safe getters were invoked");
		// The runner consumes exactly these limit flags; pin the contract.
		assert.deepEqual(Object.keys(stats.limits).sort(), ["awaits", "invocations", "nodes"]);
	});

	it("feeds listener-shaped methods a noop instead of recursing into them", async () => {
		let received: unknown = "never called";
		const { output } = await generate({
			getPlayerAPI: () => ({
				subscribe: (cb: unknown) => {
					received = cb;
					return { unsubscribe: () => {} };
				},
			}),
		});
		assert.equal(typeof received, "function", "a noop callback was supplied");
		assert.match(output, /subscribe: /);
	});

	it("never invokes methods outside the get* pattern, and renders their METHOD_TYPES signature", async () => {
		const table: readonly MethodType[] = [
			{
				on: "Platform.getDangerAPI().wipe",
				args: ["everything: true"],
				returns: "Promise<void>",
			},
		];
		let invoked = false;
		const { output } = await generate(
			{
				getDangerAPI: () => ({
					wipe: () => {
						invoked = true;
					},
				}),
			},
			table,
		);
		assert.equal(invoked, false, "wipe does not match the safe get* probe pattern");
		assert.match(output, /\(everything: true\)/);
		assert.match(output, /Promise<void>/);
	});

	it("ships a non-empty override table for the live client's mutating methods", () => {
		assert.ok(METHOD_TYPES.length > 0);
		for (const entry of METHOD_TYPES) {
			assert.match(entry.on, /^Platform\./, `${entry.on} names a Platform path`);
		}
	});
});
