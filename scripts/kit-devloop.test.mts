/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The dev-loop honesty contract (execution stamp) and the structural check
// ratchet. Both exist because a hot-push once reported a build "loaded"
// whose code had never executed, and because the ported modules drifted
// from the standard with nothing to say so.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { checkStructure } from "../packages/kit/src/check.ts";
import { formatPushResult, newNonce, stampRecord, type LocalModuleRecord } from "../packages/kit/src/push.ts";

describe("stampRecord", () => {
	const rec = (): LocalModuleRecord => ({
		metadata: { name: "m", entries: { js: "index.js" } },
		files: { "index.js": "console.log(1);" },
		sidecar: {},
	});

	it("appends an executing stamp to the js entry", () => {
		const r = rec();
		assert.equal(stampRecord(r, "m", "n-1"), true);
		assert.match(r.files["index.js"], /__spicetifyPushStamps/);
		assert.match(r.files["index.js"], /"m":"n-1"/);
		// The original content is preserved ahead of the stamp.
		assert.ok(r.files["index.js"].startsWith("console.log(1);"));
	});

	it("declines to stamp a css-only record", () => {
		const r: LocalModuleRecord = {
			metadata: { name: "t", entries: { css: "index.css" } },
			files: { "index.css": "body{}" },
			sidecar: {},
		};
		assert.equal(stampRecord(r, "t", "n-1"), false);
		assert.equal(r.files["index.css"], "body{}");
	});

	it("issues distinct nonces", () => {
		assert.notEqual(newNonce(), newNonce());
	});
});

describe("formatPushResult stamp handling", () => {
	it("passes only when the stamp proves execution", () => {
		const r = formatPushResult(JSON.stringify({ loaded: true, failed: null, stamp: "live", hadPrevious: false }));
		assert.equal(r.ok, true);
		assert.match(r.message, /verified executing/);
	});

	it("fails loudly on a stale instance even though loaded is true", () => {
		const r = formatPushResult(JSON.stringify({ loaded: true, failed: null, stamp: "stale", hadPrevious: true }));
		assert.equal(r.ok, false);
		assert.match(r.message, /did NOT execute/);
	});

	it("warns about remounting when a previous instance was live", () => {
		const r = formatPushResult(JSON.stringify({ loaded: true, failed: null, stamp: "live", hadPrevious: true }));
		assert.equal(r.ok, true);
		assert.match(r.message, /re-navigate/);
	});

	it("keeps the css-only path honest about having no stamp", () => {
		const r = formatPushResult(
			JSON.stringify({ loaded: true, failed: null, stamp: "unstamped", hadPrevious: false }),
		);
		assert.equal(r.ok, true);
		assert.match(r.message, /no execution stamp/);
	});

	it("still reports load failures first", () => {
		const r = formatPushResult(JSON.stringify({ loaded: true, failed: "boom", stamp: "live" }));
		assert.equal(r.ok, false);
		assert.match(r.message, /boom/);
	});
});

describe("checkStructure", () => {
	const roots: string[] = [];
	const make = (files: Record<string, string>, meta: object) => {
		const dir = mkdtempSync(path.join(tmpdir(), "kit-check-"));
		roots.push(dir);
		for (const [rel, content] of Object.entries(files)) {
			mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
			writeFileSync(path.join(dir, rel), content);
		}
		return { dir, meta: meta as { entries?: { js?: string } } };
	};
	after(() => {
		for (const r of roots) rmSync(r, { recursive: true, force: true });
	});

	it("is silent for a scaffold-shaped module", () => {
		const { dir, meta } = make(
			{
				"index.ts": "export async function load() {}",
				"mod.tsx":
					"import { decide } from './logic.ts';\nexport default function (ctx) { Spicetify.Player; decide(); }",
				"logic.ts": "export const decide = () => 1;",
				"logic.test.mts": "// covered",
			},
			{ entries: { js: "index.js" } },
		);
		assert.deepEqual(checkStructure(dir, meta), []);
	});

	it("flags an untested closure-shaped port on all three rules", () => {
		const { dir, meta } = make(
			{
				"index.ts": "export async function load() {}",
				"mod.tsx": "export default async function (ctx) { const f = () => Spicetify.Player.next(); f(); }",
			},
			{ entries: { js: "index.js" } },
		);
		const rules = checkStructure(dir, meta)
			.map((f) => f.rule)
			.sort();
		assert.deepEqual(rules, ["exportable-logic", "pure-core", "tests"]);
	});

	it("credits a pure exported core even without full coverage", () => {
		const { dir, meta } = make(
			{
				"index.ts": "export async function load() {}",
				"mod.tsx": "export default async function (ctx) { Spicetify.Player; }",
				"logic.ts": "export function parse(x) { return x; }",
			},
			{ entries: { js: "index.js" } },
		);
		const rules = checkStructure(dir, meta).map((f) => f.rule);
		assert.deepEqual(rules, ["tests"]);
	});

	it("exempts css-only themes entirely", () => {
		const { dir, meta } = make({ "index.css": "body{}" }, { entries: { css: "index.css" } });
		assert.deepEqual(checkStructure(dir, meta), []);
	});
});
