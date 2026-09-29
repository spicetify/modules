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

	it("keeps both timestamp containers positioned so their absolute children cannot cover the viewport", () => {
		const rule = css.match(
			/\.playback-bar__progress-time-elapsed,\s*\.main-playbackBarRemainingTime-container\s*\{([^}]*)\}/s,
		)?.[1];
		assert.ok(rule, "both timestamps must share a containing-block rule");
		assert.match(rule, /position:\s*relative\s*;/);
		assert.match(rule, /margin:\s*0\s*;/);
		assert.doesNotMatch(rule, /\bwidth\s*:/, "preserve Spotify's width for the absolute time spans");
		assert.match(css, /\.playback-bar__progress-time-elapsed::after\s*\{[^}]*content:\s*none\s*;/s);
		assert.doesNotMatch(
			css,
			/\.npv-main-container\s+\.playback-bar__progress-time-elapsed,\s*\.npv-main-container\s+\.main-playbackBarRemainingTime-container/,
		);
	});

	it("lets the client fade the top bar in on scroll", () => {
		const rule = css.match(/\.main-topBar-background\s*\{([^}]*)\}/s)?.[1];
		assert.ok(rule, "the top bar keeps its theme colour rule");
		assert.doesNotMatch(rule, /opacity/, "a forced opacity covers the entity header at scroll top");
	});

	it("clips the zoomed header image inside the rounded main view edge", () => {
		const rule = css.match(/\.main-view-container\s*>\s*\.before-scroll-node\s*\{([^}]*)\}/s)?.[1];
		assert.ok(rule, "the header image layer needs its own clip");
		assert.match(rule, /position:\s*absolute\s*;/);
		assert.match(rule, /inset:\s*1px 1px 0\s*;/);
		assert.match(rule, /overflow:\s*hidden\s*;/);
	});

	it("ships as a patch release", () => {
		assert.equal(metadata.version, "0.1.5");
	});
});
