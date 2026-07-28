/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkQuota, estimateRecordSize, interpretResult, type LocalModuleRecord } from "../src/push.ts";

// Build a record whose serialized size (code units) is ~bytes via a filler.
function recOfSize(bytes: number): LocalModuleRecord {
	const rec: LocalModuleRecord = { metadata: { identifier: "x" }, sidecar: {}, files: { "index.js": "" } };
	const fill = Math.max(0, bytes - estimateRecordSize(rec));
	rec.files["index.js"] = "a".repeat(fill);
	return rec;
}

test("checkQuota: a normal-sized install is silent", () => {
	let warned = false;
	checkQuota(recOfSize(100_000), () => {
		warned = true;
	});
	assert.equal(warned, false);
});

test("checkQuota: just under the warn threshold is silent; just over warns", () => {
	const warns: string[] = [];
	checkQuota(recOfSize(3_900_000), (m) => warns.push(m));
	assert.equal(warns.length, 0, "under the warn threshold: silent");
	checkQuota(recOfSize(4_100_000), (m) => warns.push(m));
	assert.equal(warns.length, 1, "over the warn threshold: one warning");
	assert.match(warns[0], /approaching/);
});

test("checkQuota: over the abort threshold throws, naming size, limit, and guidance", () => {
	assert.throws(
		() => checkQuota(recOfSize(4_700_000), () => {}),
		(e: Error) => /KB/.test(e.message) && /limit/.test(e.message) && /trim|split/i.test(e.message),
	);
});

test("interpretResult: a client quota exception surfaces as a named quota error", () => {
	const out = interpretResult({
		result: { exceptionDetails: { exception: { description: "QuotaExceededError: ..." } } },
	});
	assert.ok("error" in out);
	assert.match((out as { error: string }).error, /quota exceeded/i);
});

test("interpretResult: a normal value passes through unchanged", () => {
	const out = interpretResult({ result: { result: { value: '{"loaded":true}' } } });
	assert.deepEqual(out, { value: '{"loaded":true}' });
});
