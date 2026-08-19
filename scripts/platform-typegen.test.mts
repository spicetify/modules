/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The extractor normally walks the live client, but its graph walk and
// emitter are pure over any object, so a synthetic Platform proves the
// port: shapes are observed, safe getters probed, listener-shaped methods
// fed noop callbacks, and hand-written METHOD_TYPES win over probing.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

	it("probes get*() methods and types what they actually returned", async () => {
		const { output, stats } = await generate({
			getSessionAPI: () => ({
				getCount: () => 3,
				isReady: true,
			}),
		});
		assert.match(output, /getSessionAPI: /);
		assert.match(output, /=> number;/, "getCount's observed return type survives");
		assert.match(output, /isReady: boolean;/);
		assert.equal(stats.invocations, 2, "exactly the two safe getters were invoked");
		// The runner consumes exactly these limit flags; pin the contract.
		assert.deepEqual(Object.keys(stats.limits).sort(), ["awaits", "invocations", "nodes"]);
	});

	it("feeds single-callback listeners a noop and types their subscription handle", async () => {
		let received: unknown = "never called";
		let multiArg = false;
		const { output } = await generate({
			getPlayerAPI: () => ({
				subscribe: (cb: unknown) => {
					received = cb;
					return { unsubscribe: () => {} };
				},
				addListeners: (_cb: unknown, _opts: unknown) => {
					multiArg = true;
				},
			}),
		});
		assert.equal(typeof received, "function", "a noop callback was supplied");
		assert.match(output, /unsubscribe/, "the returned handle was observed and typed");
		assert.equal(multiArg, false, "a listener wanting more than one argument is never invoked");
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
		assert.match(output, /\(everything: true\)[^;]*Promise<void>/);
	});

	it("an override also suppresses probing a get*-named method", async () => {
		// The one branch that keeps mutating-but-get-named methods safe.
		let invoked = false;
		const { output } = await generate(
			{
				getDangerAPI: () => ({
					getWipe: () => {
						invoked = true;
					},
				}),
			},
			[{ on: "Platform.getDangerAPI().getWipe", args: ["dryRun: boolean"], returns: "void" }],
		);
		assert.equal(invoked, false, "the override wins over the get* probe pattern");
		assert.match(output, /\(dryRun: boolean\)/);
	});

	it("every shipped override actually lands in the committed snapshot", () => {
		// The overrides are curated against the live wrapper surface; a path
		// that stops matching (the client renamed an API, or the table uses
		// the wrong form) silently reverts that method to auto-probing.
		const snapshot = readFileSync(new URL("../platform.d.ts", import.meta.url), "utf8");
		assert.ok(METHOD_TYPES.length > 0);
		for (const entry of METHOD_TYPES) {
			const first = entry.args[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			assert.match(snapshot, new RegExp(`\\(${first}`), `${entry.on}: override never rendered`);
		}
	});
});
