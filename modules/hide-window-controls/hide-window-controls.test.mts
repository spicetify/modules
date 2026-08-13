/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { test } from "node:test";

import { createStateReconciler, resolveHiddenState, shouldHide } from "./logic.ts";

test("shouldHide defaults on and stays off only for an explicit opt-out", () => {
	assert.equal(shouldHide("1"), true);
	assert.equal(shouldHide("0"), false);
	assert.equal(shouldHide(null), true);
});

test("a requiring theme keeps the controls hidden over an explicit opt-out", () => {
	assert.equal(resolveHiddenState("0", true), true);
	assert.equal(resolveHiddenState("0", false), false);
	assert.equal(resolveHiddenState("1", false), true);
});

test("state reconciliation lets a requirement win over an in-flight toggle", async () => {
	let releaseFirst!: () => void;
	let markFirstStarted!: () => void;
	const firstPending = new Promise<void>((resolve) => (releaseFirst = resolve));
	const firstStarted = new Promise<void>((resolve) => (markFirstStarted = resolve));
	const applied: boolean[] = [];
	const reconciler = createStateReconciler(async (hidden) => {
		applied.push(hidden);
		if (applied.length === 1) {
			markFirstStarted();
			await firstPending;
		}
	});

	const staleToggle = reconciler.request(false);
	await firstStarted;
	const requirement = reconciler.request(true);
	releaseFirst();
	await Promise.all([staleToggle, requirement]);

	assert.deepEqual(applied, [false, true]);
});

test("state reconciliation lets unload win over queued work", async () => {
	let releaseFirst!: () => void;
	let markFirstStarted!: () => void;
	const firstPending = new Promise<void>((resolve) => (releaseFirst = resolve));
	const firstStarted = new Promise<void>((resolve) => (markFirstStarted = resolve));
	const applied: boolean[] = [];
	const reconciler = createStateReconciler(async (hidden) => {
		applied.push(hidden);
		if (applied.length === 1) {
			markFirstStarted();
			await firstPending;
		}
	});

	const staleRequirement = reconciler.request(true);
	await firstStarted;
	const unload = reconciler.stop(false);
	releaseFirst();
	await Promise.all([staleRequirement, unload]);

	assert.deepEqual(applied, [true, false]);
});
