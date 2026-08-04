/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFallbackPanel, captureHealthy } from "./fallback.ts";
import type { ManagerModuleRow } from "./state.ts";

const row = (over: Partial<ManagerModuleRow>): ManagerModuleRow => ({
	id: "mod",
	version: "1.0.0",
	source: "staged",
	loaded: true,
	mixedIn: true,
	dependencies: {},
	...over,
});

describe("captureHealthy", () => {
	it("requires a callable createElement - undefined or a broken shim fails", () => {
		assert.equal(captureHealthy({ createElement: () => null }), true);
		assert.equal(captureHealthy(undefined), false);
		assert.equal(captureHealthy({}), false);
		assert.equal(captureHealthy({ createElement: undefined }), false);
	});
});

describe("buildFallbackPanel", () => {
	it("renders one row per module with state-appropriate actions", () => {
		const calls: string[] = [];
		const actions = {
			disable: (id: string) => calls.push(`disable:${id}`),
			enable: (id: string) => calls.push(`enable:${id}`),
			removeLocal: (id: string) => calls.push(`remove:${id}`),
			reload: () => calls.push("reload"),
		};
		const panel = buildFallbackPanel(
			[
				row({ id: "loaded-staged" }),
				row({ id: "disabled-staged", loaded: false }),
				row({ id: "failed-local", source: "local", loaded: false, failed: "boom" }),
			],
			actions,
		);

		const items = [...panel.querySelectorAll("li")];
		assert.equal(items.length, 3);
		assert.match(items[0].textContent ?? "", /loaded-staged@1\.0\.0/);
		assert.match(items[1].textContent ?? "", /disabled/);
		assert.match(items[2].textContent ?? "", /\(local\).*failed/);

		// loaded -> Disable; disabled -> Enable; failed local -> Disable + Remove local
		assert.deepEqual(
			items.map((li) => [...li.querySelectorAll("button")].map((b) => b.textContent)),
			[["Disable"], ["Enable"], ["Disable", "Remove local"]],
		);

		(items[0].querySelector("button") as HTMLButtonElement).click();
		(items[1].querySelector("button") as HTMLButtonElement).click();
		for (const b of items[2].querySelectorAll("button")) (b as HTMLButtonElement).click();
		(panel.querySelector(".spicetify-manager-fallback__reload") as HTMLButtonElement).click();
		assert.deepEqual(calls, [
			"disable:loaded-staged",
			"enable:disabled-staged",
			"disable:failed-local",
			"remove:failed-local",
			"reload",
		]);
	});

	it("a clicked action button disables itself against double fire", () => {
		const panel = buildFallbackPanel([row({})], {
			disable: () => {},
			enable: () => {},
			removeLocal: () => {},
			reload: () => {},
		});
		const btn = panel.querySelector("button") as HTMLButtonElement;
		btn.click();
		assert.equal(btn.disabled, true);
	});
});
