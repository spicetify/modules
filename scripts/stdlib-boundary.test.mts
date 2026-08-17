/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { auditStdlibBoundary, type BoundaryPolicy } from "./stdlib-boundary.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fixture = (files: Record<string, string>) => {
	const root = mkdtempSync(path.join(tmpdir(), "stdlib-boundary-"));
	roots.push(root);
	for (const [file, text] of Object.entries(files)) {
		const target = path.join(root, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, text);
	}
	return root;
};

const policy = (overrides: Partial<BoundaryPolicy> = {}): BoundaryPolicy => ({
	schemaVersion: 1,
	categoryExceptions: [],
	exceptions: [],
	...overrides,
});

const metadata = (dependencies: Record<string, string> = { stdlib: "^1.0.0" }) =>
	JSON.stringify({
		name: "feature",
		entries: { js: "index.js" },
		dependencies,
	});

describe("stdlib boundary", () => {
	it("accepts the public barrel and primitive kit for a stdlib-dependent feature", () => {
		const root = fixture({
			"modules/feature/metadata.json": metadata(),
			"modules/feature/mod.ts": `
				import { client, React } from "/modules/stdlib/mod.ts";
				import { Button } from "/modules/stdlib/lib/primitives.js";
				export const play = () => client.player.next();
			`,
		});
		assert.deepEqual(auditStdlibBoundary(root, policy()), []);
	});

	it("rejects missing dependency, private imports, ambient access, MAP, and client DOM", () => {
		const root = fixture({
			"modules/feature/metadata.json": metadata({}),
			"modules/feature/mod.ts": `
				import { React } from "/modules/stdlib/src/expose/React.ts";
				const player = Spicetify.Player;
				const className = MAP.main.trackList.row;
				document.querySelector(".Root__main-view [data-testid='thing']");
			`,
		});
		assert.deepEqual(
			auditStdlibBoundary(root, policy())
				.map((finding) => finding.rule)
				.sort(),
			["ambient-client", "client-dom", "direct-map", "missing-stdlib-dependency", "private-stdlib-import"],
		);
	});

	it("allows only the explicitly named file and reports stale exceptions", () => {
		const root = fixture({
			"modules/feature/metadata.json": metadata(),
			"modules/feature/adapter.ts": "export const player = globalThis.Spicetify.Player;",
			"modules/feature/leak.ts": "export const player = globalThis.Spicetify.Player;",
		});
		const configured = policy({
			exceptions: [
				{
					module: "feature",
					file: "modules/feature/adapter.ts",
					rules: ["ambient-client", "direct-map"],
					reason: "fixture adapter",
				},
			],
		});
		assert.deepEqual(
			auditStdlibBoundary(root, configured).map(({ file, rule }) => [file, rule]),
			[
				["modules/feature/adapter.ts", "stale-exception"],
				["modules/feature/leak.ts", "ambient-client"],
			],
		);
	});

	it("models themes as an explicit compatibility-tested category", () => {
		const root = fixture({
			"themes/feature/metadata.json": metadata({}),
			"themes/feature/mod.ts": "Spicetify.Player.next(); document.querySelector('.Root__main-view');",
		});
		const configured = policy({
			categoryExceptions: [
				{
					root: "themes",
					rules: ["ambient-client", "client-dom", "missing-stdlib-dependency"],
					reason: "themes are tested as client integrations",
				},
			],
		});
		assert.deepEqual(auditStdlibBoundary(root, configured), []);
	});
});
