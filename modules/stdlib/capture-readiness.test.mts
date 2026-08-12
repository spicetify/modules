/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const entrySource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const readinessModule = await import("./src/webpack/capture-readiness.ts").catch(() => undefined);

test("capture readiness resolves when analysis completes later", async () => {
	assert.equal(typeof readinessModule?.createCaptureReadiness, "function");
	const readiness = readinessModule!.createCaptureReadiness({ timeoutMs: 100 });
	let resolved = false;
	void readiness.wait().then(() => (resolved = true));
	await Promise.resolve();
	assert.equal(resolved, false);
	readiness.run(
		() => {},
		() => assert.fail("analysis should not fail"),
	);
	await readiness.wait();
	assert.equal(resolved, true);
});

test("capture readiness settles degraded when analysis throws", async () => {
	assert.equal(typeof readinessModule?.createCaptureReadiness, "function");
	const readiness = readinessModule!.createCaptureReadiness({ timeoutMs: 100 });
	const failures: unknown[] = [];
	readiness.run(
		() => {
			throw new Error("broken capture");
		},
		(error) => failures.push(error),
	);
	await readiness.wait();
	assert.match(String(failures[0]), /broken capture/);
});

test("capture readiness times out instead of blocking module loads forever", async () => {
	assert.equal(typeof readinessModule?.createCaptureReadiness, "function");
	const warnings: string[] = [];
	const readiness = readinessModule!.createCaptureReadiness({
		timeoutMs: 5,
		onTimeout: () => warnings.push("timed out"),
	});
	await readiness.wait();
	assert.deepEqual(warnings, ["timed out"]);
});

test("capture readiness starts its timeout only when preload waits", async () => {
	assert.equal(typeof readinessModule?.createCaptureReadiness, "function");
	let scheduleCount = 0;
	const readiness = readinessModule!.createCaptureReadiness({
		timeoutMs: 5,
		scheduleTimeout: () => {
			scheduleCount++;
			return 1 as never;
		},
		clearScheduledTimeout: () => {},
	});
	assert.equal(scheduleCount, 0);
	void readiness.wait();
	assert.equal(scheduleCount, 1);
	readiness.run(
		() => {},
		() => assert.fail("analysis should not fail"),
	);
});

test("a capture arriving after timeout still analyzes and populates", async () => {
	assert.equal(typeof readinessModule?.createCaptureReadiness, "function");
	let releaseTimeout: (() => void) | undefined;
	const readiness = readinessModule!.createCaptureReadiness({
		timeoutMs: 5,
		scheduleTimeout: (callback) => {
			releaseTimeout = callback;
			return 1 as never;
		},
		clearScheduledTimeout: () => {},
	});
	const waiting = readiness.wait();
	releaseTimeout?.();
	await waiting;
	let analyses = 0;
	readiness.run(
		() => analyses++,
		() => assert.fail("late analysis should not fail"),
	);
	readiness.run(
		() => analyses++,
		() => assert.fail("analysis should run only once"),
	);
	assert.equal(analyses, 1);
});

test("stdlib preload blocks later module loads until capture settles", () => {
	assert.match(entrySource, /export async function preload\(/);
	assert.match(entrySource, /await waitForWebpackCapture\(\)/);
});
