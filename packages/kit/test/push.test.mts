/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import {
	checkQuota,
	estimateRecordSize,
	interpretResult,
	type LocalModuleRecord,
	pushExpression,
} from "../src/push.ts";
import { KIND_OF_META_SOURCE, kindOfMeta } from "../src/vault-metadata.ts";
import { KIND_CASES } from "./kind-cases.ts";

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

// A loader stand-in: installing a theme unloads the other loaded themes, as
// the real registry does.
function fakeLoader(modules: { identifier: string; kind?: string; tags?: string[] }[], loaded: string[]) {
	const state = new Set(loaded);
	const enabled: string[] = [];
	const isTheme = (m?: { kind?: string; tags?: string[] }) =>
		m?.kind === "theme" || (m?.tags ?? []).includes("theme");
	const Modules = {
		manifest: { modules },
		report: { failed: {} },
		list: () => modules.map((m) => ({ identifier: m.identifier, loaded: state.has(m.identifier) })),
		installLocal: async (id: string, rec: { metadata: { kind?: string; tags?: string[] } }) => {
			if (isTheme(rec.metadata))
				for (const m of modules) if (m.identifier !== id && isTheme(m)) state.delete(m.identifier);
			state.add(id);
			return {};
		},
		enable: async (id: string) => {
			enabled.push(id);
			state.add(id);
		},
	};
	return { Modules, enabled };
}

for (const declared of [{ kind: "theme" }, { tags: ["theme"] }]) {
	test(`pushing a theme leaves the other theme off (${Object.keys(declared)[0]})`, async () => {
		const { Modules, enabled } = fakeLoader(
			[
				{ identifier: "old-theme", ...declared },
				{ identifier: "new-theme", ...declared },
				{ identifier: "bookmark", kind: "extension" },
			],
			["old-theme", "bookmark"],
		);
		const rec = { metadata: { identifier: "new-theme", version: "0.1.0", ...declared }, files: {} } as never;
		const raw = await runInNewContext(pushExpression(rec, "new-theme", "n", false), {
			Spicetify: { Modules },
			setTimeout,
			JSON,
			globalThis: { Spicetify: { Modules } },
		});
		assert.equal(JSON.parse(raw).loaded, true);
		assert.deepEqual(enabled, [], "the old theme stays unloaded");
	});
}

test("the in-page kind rule matches kindOfMeta", () => {
	const inPage = runInNewContext(KIND_OF_META_SOURCE) as (meta: unknown) => unknown;
	for (const meta of KIND_CASES) assert.equal(inPage(meta), kindOfMeta(meta), JSON.stringify(meta));
	assert.equal(inPage(undefined), undefined);
});

// Installing unloads every other module, so what push re-enables shows which
// modules it judged to be themes.
async function reenabledAfterPush(pushed: Record<string, unknown>, other: Record<string, unknown>) {
	const modules = [
		{ identifier: "other", ...other },
		{ identifier: "pushed", ...pushed },
	];
	const state = new Set(["other"]);
	const enabled: string[] = [];
	const Modules = {
		manifest: { modules },
		report: { failed: {} },
		list: () => modules.map((m) => ({ identifier: m.identifier, loaded: state.has(m.identifier) })),
		installLocal: async (id: string) => {
			state.clear();
			state.add(id);
			return {};
		},
		enable: async (id: string) => {
			enabled.push(id);
			state.add(id);
		},
	};
	const rec = { metadata: { identifier: "pushed", version: "0.1.0", ...pushed }, files: {} } as never;
	await runInNewContext(pushExpression(rec, "pushed", "n", false), {
		Spicetify: { Modules },
		setTimeout,
		JSON,
		globalThis: { Spicetify: { Modules } },
	});
	return enabled.includes("other");
}

for (const meta of KIND_CASES) {
	test(`push judges ${JSON.stringify(meta)} a theme exactly when kindOfMeta does`, async () => {
		const theme = kindOfMeta(meta) === "theme";
		assert.equal(await reenabledAfterPush(meta, { kind: "theme" }), !theme, "as the pushed module");
		assert.equal(await reenabledAfterPush({ kind: "theme" }, meta), !theme, "as an installed module");
	});
}
