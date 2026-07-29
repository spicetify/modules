/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isNativeAnchor, NATIVE_ANCHOR_SELECTORS, resolveNativeAnchor } from "./nativeAnchors.ts";

test("isNativeAnchor: accepts published names, rejects others", () => {
	assert.equal(isNativeAnchor("playbar:queue"), true);
	assert.equal(isNativeAnchor("playbar:fullscreen"), true);
	assert.equal(isNativeAnchor("playbar:nope"), false);
	assert.equal(isNativeAnchor("topbar:whats-new"), false); // deliberately not published (locale-fragile)
	assert.equal(isNativeAnchor(""), false);
});

test("every published anchor uses only locale-independent selectors", () => {
	// aria-label selectors are locale-dependent and must never appear here.
	for (const [name, selectors] of Object.entries(NATIVE_ANCHOR_SELECTORS)) {
		assert.ok(selectors.length > 0, `${name} has selectors`);
		for (const s of selectors) {
			assert.ok(!/aria-label/i.test(s), `${name} selector "${s}" must not use aria-label`);
		}
	}
});

test("resolveNativeAnchor: returns the first matching element, else null", () => {
	const fakeDoc = {
		querySelector: (sel: string) =>
			sel === '[data-testid="control-button-queue"]' ? ({ tag: "queue" } as unknown as Element) : null,
	};
	assert.deepEqual(resolveNativeAnchor("playbar:queue", fakeDoc), { tag: "queue" });
	assert.equal(resolveNativeAnchor("playbar:fullscreen", fakeDoc), null);
});
