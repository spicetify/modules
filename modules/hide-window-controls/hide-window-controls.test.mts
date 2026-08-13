/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createDebouncedReassertion,
	createSharedStateReconciler,
	createStateReconciler,
	resolveHiddenState,
	shouldHide,
} from "./logic.ts";

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

test("a replacement instance wins over an in-flight stale unload", async () => {
	let releaseUnload!: () => void;
	let markUnloadStarted!: () => void;
	const unloadPending = new Promise<void>((resolve) => (releaseUnload = resolve));
	const unloadStarted = new Promise<void>((resolve) => (markUnloadStarted = resolve));
	const applied: boolean[] = [];
	const shared = { generation: 0, desired: false, transition: Promise.resolve() };
	const apply = async (hidden: boolean) => {
		applied.push(hidden);
		if (applied.length === 2) {
			markUnloadStarted();
			await unloadPending;
		}
	};

	const stale = createSharedStateReconciler(apply, shared);
	await stale.request(true);
	const staleUnload = stale.stop(false);
	await unloadStarted;
	const replacement = createSharedStateReconciler(apply, shared);
	const replacementLoad = replacement.request(true);
	releaseUnload();
	await Promise.all([staleUnload, replacementLoad]);

	assert.deepEqual(applied, [true, false, true]);
	assert.equal(shared.desired, true);
});

test("shared reconciliation ignores same-generation requests after stop", async () => {
	let releaseInitial!: () => void;
	let markInitialStarted!: () => void;
	const initialPending = new Promise<void>((resolve) => (releaseInitial = resolve));
	const initialStarted = new Promise<void>((resolve) => (markInitialStarted = resolve));
	const applied: boolean[] = [];
	const shared = { generation: 0, desired: false, transition: Promise.resolve() };
	const reconciler = createSharedStateReconciler(async (hidden) => {
		applied.push(hidden);
		if (applied.length === 1) {
			markInitialStarted();
			await initialPending;
		}
	}, shared);

	const initial = reconciler.request(true);
	await initialStarted;
	const stop = reconciler.stop(false);
	const staleRequest = reconciler.request(true);
	releaseInitial();
	await Promise.all([initial, stop, staleRequest]);

	assert.deepEqual(applied, [true, false]);
	assert.equal(shared.desired, false);
});

test("shared reconciliation can retry after an initial native failure", async () => {
	let attempts = 0;
	const applied: boolean[] = [];
	const shared = { generation: 0, desired: false, transition: Promise.resolve() };
	const reconciler = createSharedStateReconciler(async (hidden) => {
		applied.push(hidden);
		if (++attempts === 1) throw new Error("native bridge unavailable");
	}, shared);

	await assert.rejects(reconciler.request(true), /native bridge unavailable/);
	await reconciler.request(true);

	assert.deepEqual(applied, [true, true]);
});

test("shell lifecycle reassertion is debounced, contains failures, and cannot run after teardown", async () => {
	let nextId = 0;
	const pending = new Map<number, () => void>();
	let reassertions = 0;
	const errors: unknown[] = [];
	const reassertion = createDebouncedReassertion(
		async () => {
			reassertions++;
			throw new Error("native bridge unavailable");
		},
		(callback) => {
			const id = ++nextId;
			pending.set(id, () => {
				pending.delete(id);
				callback();
			});
			return id;
		},
		(id) => pending.delete(id),
		(error) => errors.push(error),
	);

	reassertion.trigger();
	reassertion.trigger();
	assert.equal(pending.size, 1);
	for (const callback of pending.values()) callback();
	await Promise.resolve();
	assert.equal(reassertions, 1);
	assert.match(String(errors[0]), /native bridge unavailable/);

	reassertion.trigger();
	reassertion.stop();
	assert.equal(pending.size, 0);
	assert.equal(reassertions, 1);
});
