/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { checkModule } from "../src/check.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function moduleFixture(files: Record<string, string>, overrides: Record<string, unknown> = {}): string {
	const root = mkdtempSync(path.join(tmpdir(), "kit-stdlib-boundary-"));
	roots.push(root);
	const metadata = {
		name: "external-feature",
		kind: "extension",
		version: "1.0.0",
		description: "fixture",
		authors: ["spicetify"],
		entries: { js: "index.js" },
		hasMixins: false,
		dependencies: { stdlib: "^1.10.0" },
		...overrides,
	};
	writeFileSync(path.join(root, "metadata.json"), `${JSON.stringify(metadata, null, "\t")}\n`);
	for (const [file, contents] of Object.entries(files)) {
		const target = path.join(root, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, contents);
	}
	return root;
}

const rules = (dir: string) => checkModule(dir).map(({ rule, severity }) => `${severity}:${rule}`);

describe("external stdlib boundary", () => {
	it("rejects private stdlib imports and a missing direct dependency", () => {
		const dir = moduleFixture(
			{
				"index.ts": 'export function load() { return import("./mod.js"); }',
				"mod.ts": 'import { React } from "/modules/stdlib/src/expose/React.ts";',
			},
			{ dependencies: {} },
		);
		assert.ok(rules(dir).includes("error:stdlib-boundary.private-import"));
		assert.ok(rules(dir).includes("error:stdlib-boundary.dependency"));
	});

	it("warns on ambient client, MAP, and Spotify-owned DOM coupling", () => {
		const dir = moduleFixture({
			"index.ts": 'export function load() { return import("./mod.js"); }',
			"mod.ts": `
				const player = Spicetify.Player;
				const row = MAP.main.trackList.row;
				document.querySelector(".Root__main-view [data-testid='row']");
			`,
			"index.scss": ".main-nowPlayingBar-nowPlayingBar { color: red; }",
		});
		const findings = rules(dir);
		assert.ok(findings.includes("warn:stdlib-boundary.ambient-client"));
		assert.ok(findings.includes("warn:stdlib-boundary.direct-map"));
		assert.ok(findings.includes("warn:stdlib-boundary.client-dom"));
	});

	it("accepts reasoned file-level warning exceptions and rejects stale entries", () => {
		const exception = {
			file: "mod.ts",
			rules: ["client-dom"],
			reason: "This feature attaches to Spotify's active main viewport.",
		};
		const dir = moduleFixture(
			{
				"index.ts": 'export function load() { return import("./mod.js"); }',
				"mod.ts": 'document.querySelector(".Root__main-view");',
			},
			{ stdlibBoundary: { exceptions: [exception] } },
		);
		assert.ok(!rules(dir).includes("warn:stdlib-boundary.client-dom"));

		writeFileSync(path.join(dir, "mod.ts"), "export const owned = true;");
		assert.ok(rules(dir).includes("error:stdlib-boundary.stale-exception"));
	});

	it("does not allow exceptions for private stdlib imports", () => {
		const dir = moduleFixture(
			{
				"index.ts": 'export function load() { return import("./mod.js"); }',
				"mod.ts": 'import { React } from "/modules/stdlib/src/expose/React.ts";',
			},
			{
				stdlibBoundary: {
					exceptions: [{ file: "mod.ts", rules: ["private-stdlib-import"], reason: "fixture" }],
				},
			},
		);
		assert.ok(rules(dir).includes("error:metadata.stdlib-boundary"));
		assert.ok(rules(dir).includes("error:stdlib-boundary.private-import"));
	});

	it("treats themes as client-coupled while still rejecting private stdlib imports", () => {
		const dir = moduleFixture(
			{
				"index.ts": 'export function load() { return import("./mod.js"); }',
				"mod.ts": `
					import { React } from "/modules/stdlib/src/expose/React.ts";
					Spicetify.Player.next();
					document.querySelector(".Root__main-view");
				`,
			},
			{ kind: "theme", dependencies: {} },
		);
		const findings = rules(dir);
		assert.ok(findings.includes("error:stdlib-boundary.private-import"));
		assert.ok(!findings.includes("error:stdlib-boundary.dependency"));
		assert.ok(!findings.includes("warn:stdlib-boundary.ambient-client"));
		assert.ok(!findings.includes("warn:stdlib-boundary.client-dom"));
	});
});
