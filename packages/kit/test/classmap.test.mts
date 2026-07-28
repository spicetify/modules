/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";

import { resolveClassmap } from "../src/classmap.ts";

const MAP = JSON.stringify({ main: { x: "y" } });
const tmps: string[] = [];
function mk(): string {
	const d = mkdtempSync(path.join(tmpdir(), "kit-cm-"));
	tmps.push(d);
	return d;
}
// Write a classmap json under <root>/<key>/classmap.json.
function writeKey(root: string, key: string): void {
	const dir = path.join(root, key);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "classmap.json"), MAP);
}

const savedFetch = globalThis.fetch;
const savedVendor = process.env.SPICETIFY_KIT_VENDOR_CLASSMAPS;
const savedCache = process.env.XDG_CACHE_HOME;
beforeEach(() => {
	// Point the cache and vendored dirs at throwaway locations, and cut the
	// network by default so tests are deterministic.
	const cache = mk();
	process.env.XDG_CACHE_HOME = cache;
	process.env.SPICETIFY_KIT_VENDOR_CLASSMAPS = path.join(mk(), "empty");
	globalThis.fetch = (() => {
		throw new Error("network disabled in test");
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = savedFetch;
	if (savedVendor === undefined) delete process.env.SPICETIFY_KIT_VENDOR_CLASSMAPS;
	else process.env.SPICETIFY_KIT_VENDOR_CLASSMAPS = savedVendor;
	if (savedCache === undefined) delete process.env.XDG_CACHE_HOME;
	else process.env.XDG_CACHE_HOME = savedCache;
});
after(() => {
	for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

test("offline: a vendored snapshot alone resolves (no network, no cache, no local)", async () => {
	const vendor = mk();
	writeKey(vendor, "1020094");
	process.env.SPICETIFY_KIT_VENDOR_CLASSMAPS = vendor;
	const r = await resolveClassmap({ flag: null, config: {}, cwd: mk() });
	assert.equal(r.key, "1020094");
	assert.ok(r.path);
});

test("newest key wins across vendored and cache, in both directions", async () => {
	// vendored newer than cache
	const v1 = mk();
	writeKey(v1, "1020094");
	process.env.SPICETIFY_KIT_VENDOR_CLASSMAPS = v1;
	writeKey(path.join(process.env.XDG_CACHE_HOME!, "spicetify-kit", "classmaps"), "1020090");
	assert.equal((await resolveClassmap({ flag: null, config: {}, cwd: mk() })).key, "1020094");

	// cache newer than vendored
	const v2 = mk();
	writeKey(v2, "1020080");
	process.env.SPICETIFY_KIT_VENDOR_CLASSMAPS = v2;
	writeKey(path.join(process.env.XDG_CACHE_HOME!, "spicetify-kit", "classmaps"), "1020099");
	assert.equal((await resolveClassmap({ flag: null, config: {}, cwd: mk() })).key, "1020099");
});

test("local classmaps dir beats vendored/cache; flag key selects a specific key", async () => {
	const cwd = mk();
	const local = path.join(cwd, "classmaps");
	writeKey(local, "1020070");
	writeKey(local, "1020094");
	const vendor = mk();
	writeKey(vendor, "1020099");
	process.env.SPICETIFY_KIT_VENDOR_CLASSMAPS = vendor;
	// no flag: newest local wins over newer vendored (local tier is first)
	assert.equal((await resolveClassmap({ flag: null, config: {}, cwd })).key, "1020094");
	// explicit key: resolves that exact key, not the newest
	assert.equal((await resolveClassmap({ flag: "1020070", config: {}, cwd })).key, "1020070");
});

test("flag beats config", async () => {
	const cwd = mk();
	writeKey(path.join(cwd, "classmaps"), "1020070");
	writeKey(path.join(cwd, "classmaps"), "1020094");
	const r = await resolveClassmap({ flag: "1020070", config: { classmap: "1020094" }, cwd });
	assert.equal(r.key, "1020070");
});

test("--refresh forces the fetch path even when a newer key is cached locally", async () => {
	const cwd = mk();
	writeKey(path.join(cwd, "classmaps"), "1020099");
	let fetched = false;
	globalThis.fetch = (async (url: string) => {
		fetched = true;
		if (String(url).includes("api.github.com") && String(url).endsWith("/contents/")) {
			return new Response(JSON.stringify([{ type: "dir", name: "1020094" }]), { status: 200 });
		}
		if (String(url).includes("api.github.com")) {
			return new Response(JSON.stringify([{ type: "file", name: "classmap.json" }]), { status: 200 });
		}
		return new Response(MAP, { status: 200 });
	}) as typeof fetch;
	const r = await resolveClassmap({ flag: null, config: {}, cwd, refresh: true });
	assert.ok(fetched, "refresh hit the network");
	assert.equal(r.key, "1020094");
});

test("--refresh failure warns and falls back to the normal order", async () => {
	const cwd = mk();
	writeKey(path.join(cwd, "classmaps"), "1020094");
	globalThis.fetch = (async () => {
		throw new Error("offline");
	}) as typeof fetch;
	const r = await resolveClassmap({ flag: null, config: {}, cwd, refresh: true });
	assert.equal(r.key, "1020094");
});
