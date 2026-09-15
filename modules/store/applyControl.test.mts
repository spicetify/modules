/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Window } from "happy-dom";

import { APPLY_URI, createApplyControl, supportsAppHandoff } from "./applyControl.ts";
import { markStdlibDiskStaged, stdlibDiskStaged } from "./runtime.ts";

let window: Window;
let control: ReturnType<typeof createApplyControl>;
let running = "1.10.0";
let available = true;
let applies = 0;
let applyError: Error | undefined;
let copied: string | undefined;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function click(label: string) {
	const button = [...control.node.querySelectorAll("button")].find((button) => button.textContent === label);
	assert.ok(button, `Missing button: ${label}`);
	button.click();
}

async function mount() {
	control = createApplyControl();
	document.body.append(control.node);
	void control.refresh();
	await flush();
}

beforeEach(() => {
	window = new Window();
	running = "1.10.0";
	available = true;
	applies = 0;
	applyError = undefined;
	copied = undefined;
	Object.defineProperties(globalThis, {
		document: { configurable: true, value: window.document },
		localStorage: { configurable: true, value: window.localStorage },
		navigator: {
			configurable: true,
			value: {
				userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Spotify/1.2.97",
				clipboard: {
					writeText: async (text: string) => {
						copied = text;
					},
				},
			},
		},
		Spicetify: {
			configurable: true,
			value: {
				Modules: { list: () => [{ identifier: "stdlib", version: running }] },
				Daemon: {
					available: async () => available,
					apply: async () => {
						applies++;
						if (applyError) throw applyError;
					},
				},
			},
		},
	});
	markStdlibDiskStaged("1.11.2");
});

afterEach(() => {
	control?.dispose();
	void window.happyDOM.close();
});

describe("Store apply and recovery", () => {
	it("requires a reachable daemon, not just the presence of its API", async () => {
		available = false;
		await mount();
		assert.match(control.node.textContent ?? "", /service is unavailable/);
		click("Repair Spicetify");
		assert.equal(applies, 0);
		const link = control.node.querySelector("input");
		assert.equal(link?.value, APPLY_URI);
		assert.equal(link?.readOnly, true);
	});

	it("keeps confirmation until Confirm or Cancel instead of expiring after four seconds", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		await mount();
		click("Apply stdlib update");
		t.mock.timers.tick(5000);
		await flush();
		assert.match(control.node.textContent ?? "", /Apply and restart/);
		assert.equal(applies, 0);
		click("Cancel");
		assert.match(control.node.textContent ?? "", /Apply stdlib update/);
		assert.equal(applies, 0);
	});

	it("dispatches once and never treats socket submission as successful completion", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		await mount();
		click("Apply stdlib update");
		click("Apply and restart");
		await flush();
		assert.equal(applies, 1);
		assert.match(control.node.textContent ?? "", /Waiting for Spotify to restart/);
		assert.equal(control.node.querySelector("button"), null);
		t.mock.timers.tick(30000);
		await flush();
		assert.match(control.node.textContent ?? "", /may still be running/);
		assert.equal(applies, 1);
		assert.equal(control.node.querySelector("a"), null, "never silently retries via the app");
	});

	it("keeps a failed apply visible across background refreshes and offers explicit recovery", async () => {
		applyError = new Error("daemon refused the connection");
		await mount();
		click("Apply stdlib update");
		click("Apply and restart");
		await flush();
		await control.refresh(true);
		assert.match(control.node.textContent ?? "", /Apply failed: daemon refused/);
		assert.equal(control.node.querySelector("a"), null);
		click("Open Spicetify app instead");
		assert.equal(control.node.querySelector("input")?.value, APPLY_URI);
	});

	it("copies a browser recovery link without claiming the app launched", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		available = false;
		await mount();
		click("Repair Spicetify");
		click("Copy recovery link");
		await flush();
		assert.equal(copied, APPLY_URI);
		assert.equal(control.node.querySelector("a"), null, "Spotify silently drops native scheme links");
		assert.match(control.node.textContent ?? "", /Paste it into your browser's address bar/);
		t.mock.timers.tick(30000);
		await flush();
		assert.match(control.node.textContent ?? "", /Recovery link copied/);
		assert.equal(applies, 0);
	});

	it("provides a selectable recovery link when the clipboard is unavailable", async () => {
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: { userAgent: "Macintosh Spotify/1.2.97" },
		});
		available = false;
		await mount();
		click("Repair Spicetify");
		click("Copy recovery link");
		await flush();
		assert.match(control.node.textContent ?? "", /Clipboard unavailable/);
		const input = control.node.querySelector("input");
		assert.equal(input?.value, APPLY_URI);
		assert.equal(document.activeElement, input);
		assert.equal(input?.selectionEnd, APPLY_URI.length);
	});

	it("removes the stale banner once the loader lists the newer running stdlib", async () => {
		await mount();
		assert.equal(stdlibDiskStaged(), "1.11.2");
		running = "1.11.2";
		await control.refresh(true);
		assert.equal(stdlibDiskStaged(), null);
		assert.equal(control.node.hidden, true);
	});

	it("hides the healthy control despite Spotify's section display reset", async () => {
		const css = readFileSync(new URL("./index.scss", import.meta.url), "utf8");
		const hiddenRule = css.match(/\.spicetify-store-apply\[hidden\]\s*\{[^}]+\}/)?.[0];
		assert.ok(hiddenRule);
		const style = document.createElement("style");
		style.textContent = "section { display: block; }";
		document.head.append(style);
		running = "1.11.2";
		await mount();
		const rendered = window.document.querySelector(".spicetify-store-apply");
		assert.ok(rendered);
		assert.equal(window.getComputedStyle(rendered).display, "block", "Spotify overrides native hidden");
		style.textContent += hiddenRule;
		assert.equal(window.getComputedStyle(rendered).display, "none");
	});

	it("offers service recovery even when there is no stdlib update left to apply", async () => {
		running = "1.11.2";
		available = false;
		await mount();
		assert.equal(stdlibDiskStaged(), null);
		assert.equal(control.node.hidden, false);
		click("Repair Spicetify");
	});

	it("bounds a hanging health check and ignores its late result", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		let finish: (ready: boolean) => void = () => {};
		Object.defineProperty(globalThis, "Spicetify", {
			configurable: true,
			value: {
				Modules: { list: () => [] },
				Daemon: {
					available: () =>
						new Promise<boolean>((resolve) => {
							finish = resolve;
						}),
					apply: async () => {},
				},
			},
		});
		await mount();
		t.mock.timers.tick(3000);
		await flush();
		assert.match(control.node.textContent ?? "", /Repair Spicetify/);
		finish(true);
		await flush();
		assert.match(control.node.textContent ?? "", /Repair Spicetify/);
	});

	it("does not expose native app recovery in a web or unsupported client", async () => {
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: { userAgent: "Mozilla/5.0 (Macintosh) Chrome/145" },
		});
		available = false;
		await mount();
		assert.doesNotMatch(control.node.textContent ?? "", /Repair Spicetify/);
		assert.match(control.node.textContent ?? "", /only in the Spotify desktop client/);
	});

	it("does not settle staged state after the control has been disposed", async () => {
		let finish: (ready: boolean) => void = () => {};
		Object.defineProperty(globalThis, "Spicetify", {
			configurable: true,
			value: {
				Modules: { list: () => [{ identifier: "stdlib", version: running }] },
				Daemon: {
					available: () =>
						new Promise<boolean>((resolve) => {
							finish = resolve;
						}),
					apply: async () => {},
				},
			},
		});
		await mount();
		control.dispose();
		running = "1.11.2";
		finish(true);
		await flush();
		assert.equal(stdlibDiskStaged(), "1.11.2");
		assert.equal(control.node.isConnected, false);
	});

	it("keeps the app handoff limited to desktop platforms with registered handlers", () => {
		assert.equal(supportsAppHandoff("Macintosh Spotify/1.2.97"), true);
		assert.equal(supportsAppHandoff("Windows NT 10.0 Spotify/1.2.97"), true);
		assert.equal(supportsAppHandoff("Linux x86_64 Spotify/1.2.97"), true);
		assert.equal(supportsAppHandoff("Android Linux Spotify/1.2.97"), false);
		assert.equal(supportsAppHandoff("Macintosh Chrome/145"), false);
	});
});
