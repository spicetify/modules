import "../stdlib/lib/test-setup.mts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getSplashImage, readSplashImage, resetSplashImage, saveSplashImage } from "./image.ts";

afterEach(resetSplashImage);

test("uses the Spicetify logo by default and restores it after reset", async () => {
	assert.equal(getSplashImage(), null);
	const file = new window.File(
		['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="5" fill="red"/></svg>'],
		"custom.svg",
		{ type: "image/svg+xml" },
	);
	const source = await readSplashImage(file);
	saveSplashImage(source);
	assert.notEqual(getSplashImage(), null);
	assert.equal(Buffer.from(getSplashImage()!.split(",")[1], "base64").toString(), await file.text());
	resetSplashImage();
	assert.equal(getSplashImage(), null);
});

test("rejects unsupported, oversized, and unsafe images while keeping the previous image", async () => {
	const previous = "data:image/png;base64,iVBORw0KGgo=";
	saveSplashImage(previous);
	await assert.rejects(readSplashImage(new window.File(["hello"], "text.txt", { type: "text/plain" })), /PNG/);
	await assert.rejects(
		readSplashImage(new window.File([new Uint8Array(513 * 1024)], "large.png", { type: "image/png" })),
		/512 KB/,
	);
	assert.throws(() => saveSplashImage('data:image/png;base64,abc" onerror="alert(1)'), /supported image/);
	assert.equal(getSplashImage(), previous);
});

test("malformed saved preferences fall back to the logo", () => {
	localStorage.setItem("spicetify:splash:image", "https://example.com/tracking.png");
	assert.equal(getSplashImage(), null);
});
