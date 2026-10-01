import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { showSplash } from "./splash.ts";
import { saveCustomCss } from "./theme.ts";

let splash: ReturnType<typeof showSplash> | undefined;
afterEach(() => {
	splash?.dispose();
	splash = undefined;
	document.body.replaceChildren();
	document.head.replaceChildren();
	document.adoptedStyleSheets = [];
	localStorage.clear();
});

const adoptedCss = () =>
	document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("");
const adopt = (css: string) => {
	const sheet = new window.CSSStyleSheet();
	sheet.replaceSync(css);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
	return sheet;
};

const dialog = () => document.querySelector<HTMLDialogElement>("dialog.spicetify-splash");

test("shows a modal splash with the vector logo before Spotify or its APIs exist", () => {
	splash = showSplash();
	assert.ok(dialog()?.open);
	assert.equal(dialog()!.getAttribute("aria-label"), "Spicetify is loading");
	assert.equal(dialog()!.textContent.trim(), "");
	assert.equal(dialog()!.dataset.stage, "boot");
	assert.equal(dialog()!.dataset.image, "default");
	assert.ok(dialog()!.querySelector(".spicetify-splash__logo svg.spicetify-splash__mark"));
	assert.equal(document.querySelector("main"), null);
});

test("a saved image replaces the logo", () => {
	localStorage.setItem("spicetify:splash:image", "data:image/png;base64,iVBORw0KGgo=");
	splash = showSplash();
	assert.equal(dialog()!.dataset.image, "custom");
	assert.equal(dialog()!.querySelector("img")?.getAttribute("src"), "data:image/png;base64,iVBORw0KGgo=");
	assert.equal(dialog()!.querySelector("svg"), null);
});

test("keeps the splash until the interface and module loading are both ready", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	let modulesLoaded = false;
	splash = showSplash();
	splash.watchReady(() => !!document.querySelector("main") && modulesLoaded);
	assert.equal(dialog()!.dataset.stage, "loading");
	document.body.appendChild(document.createElement("main"));
	t.mock.timers.tick(500);
	assert.equal(dialog()!.dataset.stage, "loading");
	modulesLoaded = true;
	t.mock.timers.tick(100);
	assert.equal(dialog()!.dataset.stage, "leaving");
	t.mock.timers.tick(450);
	assert.equal(dialog(), null);
	assert.equal(document.querySelector("style[data-spicetify-splash]"), null);
});

test("saved custom CSS stays after theme sheets adopted mid-startup and leaves with the splash", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	saveCustomCss(".spicetify-splash { --splash-accent: hotpink; }");
	splash = showSplash();
	assert.match(adoptedCss(), /hotpink/);
	splash.watchReady(() => false);
	const theme = adopt(".spicetify-splash { --splash-accent: teal; }");
	t.mock.timers.tick(100);
	assert.notEqual(document.adoptedStyleSheets.at(-1), theme);
	assert.match(String([...document.adoptedStyleSheets.at(-1)!.cssRules].map((r) => r.cssText)), /hotpink/);
	splash.dispose();
	assert.equal(document.adoptedStyleSheets.length, 1);
	assert.equal(document.querySelector("style[data-spicetify-splash]"), null);
});

test("a ready startup records theme splash rules so the next splash paints them first", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const theme = document.createElement("style");
	theme.textContent = `
		.spicetify-splash__caption::after { content: "hello"; animation: theme-wave 1s infinite; }
		@keyframes theme-wave { to { opacity: 0.5; } }
		@keyframes spicetify { to { opacity: 0; } }
		@keyframes unrelated { to { opacity: 0; } }
		.main-view { color: red; }
		@media (min-width: 1px) { .spicetify-splash { --splash-accent: teal; } .other { color: blue; } }`;
	document.head.appendChild(theme);
	splash = showSplash();
	splash.watchReady(() => true);
	t.mock.timers.tick(450);
	theme.remove();

	splash = showSplash();
	const cached = localStorage.getItem("spicetify:splash:theme") ?? "";
	const painted = [...document.querySelectorAll("style[data-spicetify-splash]")].map((s) => s.textContent);
	assert.ok(painted.includes(cached));
	assert.match(cached, /@layer spicetify-splash-theme\s*\{.*\.spicetify-splash__caption::after/s);
	assert.match(cached, /@keyframes theme-wave/);
	assert.match(cached, /@media[^{]*\{\s*\.spicetify-splash\s*\{[^}]*teal/);
	assert.doesNotMatch(cached, /main-view|unrelated|\.other|@keyframes spicetify\b/);
});

test("a recorded theme does not carry over once the theme stops defining it", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	document.documentElement.style.setProperty("--spice-button", "#ff0000");
	splash = showSplash();
	splash.watchReady(() => true);
	t.mock.timers.tick(450);
	assert.match(localStorage.getItem("spicetify:splash:theme") ?? "", /--spice-button:#ff0000/);
	document.documentElement.style.removeProperty("--spice-button");
	splash = showSplash();
	splash.watchReady(() => true);
	t.mock.timers.tick(450);
	assert.equal(localStorage.getItem("spicetify:splash:theme"), null);
});

test("a timed-out startup keeps the previously recorded theme rules", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	t.mock.method(console, "warn", () => {});
	localStorage.setItem("spicetify:splash:theme", ".spicetify-splash { --splash-accent: teal; }");
	splash = showSplash();
	splash.watchReady(() => false);
	t.mock.timers.tick(30_000);
	t.mock.timers.tick(450);
	assert.equal(localStorage.getItem("spicetify:splash:theme"), ".spicetify-splash { --splash-accent: teal; }");
});

test("a preview stays until clicked, uses draft CSS, and never records theme rules", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	saveCustomCss(".saved { color: red; }");
	splash = showSplash({ preview: true, css: ".draft { color: red; }" });
	assert.match(adoptedCss(), /\.draft/);
	assert.doesNotMatch(adoptedCss(), /\.saved/);
	t.mock.timers.tick(60_000);
	assert.ok(dialog()?.open);
	dialog()!.dispatchEvent(new Event("click"));
	t.mock.timers.tick(450);
	assert.equal(dialog(), null);
	assert.equal(localStorage.getItem("spicetify:splash:theme"), null);
});

test("Escape dismisses the splash before load runs", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	splash = showSplash();
	dialog()!.dispatchEvent(new Event("cancel", { cancelable: true }));
	t.mock.timers.tick(450);
	assert.equal(dialog(), null);
});

test("reduced motion dismisses immediately without scheduling a fade", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	t.mock.method(window, "matchMedia", () => ({ matches: true }));
	splash = showSplash();
	splash.watchReady(() => true);
	assert.equal(dialog(), null);
	assert.equal(document.querySelector("style[data-spicetify-splash]"), null);
});

test("a stalled startup cannot leave the splash open indefinitely", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const warning = t.mock.method(console, "warn", () => {});
	splash = showSplash();
	t.mock.timers.tick(30_000);
	t.mock.timers.tick(450);
	assert.equal(dialog(), null);
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
	assert.equal(dialog(), null);
	assert.equal(document.querySelector("style[data-spicetify-splash]"), null);
});
