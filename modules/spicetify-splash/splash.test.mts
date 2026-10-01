import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { showSplash } from "./splash.ts";

let splash: ReturnType<typeof showSplash> | undefined;
afterEach(() => {
	splash?.dispose();
	splash = undefined;
	document.body.replaceChildren();
});

test("shows a modal splash before Spotify or its APIs exist", () => {
	splash = showSplash();
	const dialog = document.querySelector("dialog");
	assert.ok(dialog?.open);
	assert.equal(dialog.getAttribute("aria-label"), "Spicetify is loading");
	assert.equal(dialog.textContent.trim(), "");
	assert.ok(dialog.querySelector("img"));
	assert.equal(document.querySelector("main"), null);
});

test("keeps the splash until the interface and module loading are both ready", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	let modulesLoaded = false;
	splash = showSplash();
	splash.watchReady(() => !!document.querySelector("main") && modulesLoaded);
	document.body.appendChild(document.createElement("main"));
	t.mock.timers.tick(500);
	assert.equal(document.querySelector("dialog")?.classList.contains("spicetify-splash-leaving"), false);
	modulesLoaded = true;
	t.mock.timers.tick(100);
	assert.ok(document.querySelector("dialog")?.classList.contains("spicetify-splash-leaving"));
	t.mock.timers.tick(200);
	assert.equal(document.querySelector("dialog"), null);
	assert.equal(document.querySelector("style[data-spicetify-splash]"), null);
});

test("Escape dismisses the image-only splash before load runs", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	splash = showSplash();
	document.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true }));
	t.mock.timers.tick(200);
	assert.equal(document.querySelector("dialog"), null);
});

test("reduced motion dismisses immediately without scheduling a fade", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	t.mock.method(window, "matchMedia", () => ({ matches: true }));
	splash = showSplash();
	splash.watchReady(() => true);
	assert.equal(document.querySelector("dialog"), null);
	assert.equal(document.querySelector("style[data-spicetify-splash]"), null);
});

test("a stalled startup cannot leave the splash open indefinitely", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const warning = t.mock.method(console, "warn", () => {});
	splash = showSplash();
	t.mock.timers.tick(30_000);
	t.mock.timers.tick(200);
	assert.equal(document.querySelector("dialog"), null);
	assert.equal(warning.mock.calls.length, 1);
});

test("unloading removes the modal and cancels later startup work", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const warning = t.mock.method(console, "warn", () => {});
	let readinessChecks = 0;
	splash = showSplash();
	splash.watchReady(() => {
		readinessChecks++;
		return false;
	});
	splash.dispose();
	splash.dispose();
	const checksBefore = readinessChecks;
	t.mock.timers.tick(60_000);
	assert.equal(readinessChecks, checksBefore);
	assert.equal(warning.mock.calls.length, 0);
	assert.equal(document.querySelector("dialog"), null);
	assert.equal(document.querySelector("style[data-spicetify-splash]"), null);
});
