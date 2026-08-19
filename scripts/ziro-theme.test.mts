import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const css = await readFile(new URL("../themes/ziro/index.css", import.meta.url), "utf8");
const metadata = JSON.parse(await readFile(new URL("../themes/ziro/metadata.json", import.meta.url), "utf8"));

describe("ziro current-client compatibility", () => {
	it("delegates client fades to the shared theme-colour bridge", () => {
		assert.doesNotMatch(css, /\.search-searchCategory-contentArea::(?:before|after)/);
		assert.doesNotMatch(css, /\.main-nowPlayingView-contextItemInfo::before/);
	});

	it("uses the current playback bar flow for both timestamps", () => {
		assert.match(
			css,
			/\.playback-bar__progress-time-elapsed,\s*\.main-playbackBarRemainingTime-container\s*\{[^}]*position:\s*static\s*;[^}]*margin:\s*0\s*;[^}]*width:\s*auto\s*;/s,
		);
		assert.match(css, /\.playback-bar__progress-time-elapsed::after\s*\{[^}]*content:\s*none\s*;/s);
		assert.doesNotMatch(
			css,
			/\.npv-main-container\s+\.playback-bar__progress-time-elapsed,\s*\.npv-main-container\s+\.main-playbackBarRemainingTime-container/,
		);
	});

	it("ships as a patch release", () => {
		assert.equal(metadata.version, "0.1.3");
	});
});
