/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = async (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const floating = await read("./floating.tsx");
const vanillaPopover = await read("./popover.ts");
const primitives = await read("./primitives.tsx");
const styles = await read("../index.scss");
const metadata = JSON.parse(await read("../metadata.json"));
const kit = JSON.parse(await read("../../../packages/kit/package.json"));

// True when a version is 1.10.0 or newer, compared numerically per part.
// Build metadata is stripped (it has no precedence), and a prerelease of the
// floor deliberately does not satisfy it.
const satisfiesFloor = (version: string): boolean => {
	const [core] = version.split("+");
	const [release] = core!.split("-");
	const parts = release!.split(".").map(Number);
	const floor = [1, 10, 0];
	for (let i = 0; i < floor.length; i++) {
		if ((parts[i] ?? 0) !== floor[i]) return (parts[i] ?? 0) > floor[i]!;
	}
	return version.includes("-") ? false : true;
};

describe("stdlib-owned floating surfaces", () => {
	it("exports reusable React tooltip and popover primitives", () => {
		for (const name of ["Tooltip", "Popover", "PopoverMenu", "PopoverMenuItem"]) {
			assert.match(primitives, new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`));
		}
		assert.match(floating, /export const Tooltip/);
		assert.match(floating, /export const Popover/);
		assert.match(floating, /export const PopoverMenu/);
		assert.match(floating, /export const PopoverMenuItem/);
	});

	it("owns accessible tooltip dismissal and hover persistence", () => {
		assert.match(floating, /role="tooltip"/);
		assert.match(floating, /aria-describedby/);
		assert.match(floating, /TOOLTIP_HIDE_DELAY_MS\s*=\s*300/);
		assert.match(floating, /onClickCapture=\{dismiss\}/);
		assert.match(floating, /event\.key\s*!==\s*"Escape"/);
		assert.match(floating, /event\.preventDefault\(\)/);
		assert.match(floating, /event\.stopPropagation\(\)/);
	});

	it("owns popover semantics, dismissal, and viewport-aware chrome", () => {
		assert.match(floating, /aria-haspopup/);
		assert.match(floating, /aria-expanded/);
		assert.match(floating, /document\.addEventListener\("mousedown"/);
		assert.match(floating, /document\.addEventListener\("keydown"/);
		assert.match(floating, /originalClick\?\.\(event\)/);
		assert.match(floating, /if \(!event\.defaultPrevented\) toggle\(\)/);
		assert.doesNotMatch(floating, /className="spicetify-floating-anchor"\s+onClick=/);
		assert.match(styles, /\.spicetify-tooltip,\s*\.spicetify-popover\s*\{[^}]*position:\s*fixed/s);
		assert.match(vanillaPopover, /calculateFloatingPosition\s*\(/);
		assert.doesNotMatch(vanillaPopover, /Object\.assign\(host\.style|\bas any\b/);
	});

	it("removes private ReactComponent access from the shared primitives", () => {
		assert.doesNotMatch(primitives, /Spicetify\.ReactComponent/);
	});

	it("ships the floating API through the current kit", () => {
		// The API landed in 1.10.0; the kit must scaffold against a stdlib
		// that carries it, and the pin must track the workspace version.
		assert.ok(satisfiesFloor(metadata.version), `stdlib ${metadata.version} predates the floating API`);
		assert.equal(kit.spicetify.stdlibVersion, metadata.version);
	});
});
