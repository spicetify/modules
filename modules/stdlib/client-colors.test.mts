import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const scss = await readFile(new URL("./_client-colors.scss", import.meta.url), "utf8");
const metadata = JSON.parse(await readFile(new URL("./metadata.json", import.meta.url), "utf8"));
const kitPackage = JSON.parse(await readFile(new URL("../../packages/kit/package.json", import.meta.url), "utf8"));
const explicitCarouselThemes = await Promise.all(
	["text", "matte"].map(async (theme) => ({
		theme,
		css: await readFile(new URL(`../../themes/${theme}/index.css`, import.meta.url), "utf8"),
	})),
);

describe("shared client colour bridge", () => {
	it("colors carousel edge fades from the active theme surface", () => {
		assert.match(
			scss,
			/:where\(html\.spicetify-themed\)\s+\.search-searchCategory-contentArea\s*\{[^}]*--carousel-start-chevron-gradient:\s*rgba\(var\(--spice-rgb-main\),\s*0\.7\);[^}]*--carousel-end-chevron-gradient:\s*rgba\(var\(--spice-rgb-main\),\s*0\.7\);/s,
		);
	});

	it("lets explicit per-theme carousel treatments win by source order", () => {
		for (const { theme, css } of explicitCarouselThemes) {
			assert.match(
				css,
				/\.search-searchCategory-contentArea\s*\{[^}]*--carousel-start-chevron-gradient:\s*var\(--spice-main\);[^}]*--carousel-end-chevron-gradient:\s*var\(--spice-main\);/s,
				`${theme} should retain its opaque carousel treatment`,
			);
		}
	});

	it("colors the Now Playing metadata fade from the active theme surface", () => {
		assert.match(
			scss,
			/\.main-nowPlayingView-contextItemInfo::before\s*\{[^}]*background-image:\s*linear-gradient\([^;]*var\(--spice-rgb-main\)[^;]*var\(--spice-main\)[^;]*\);/s,
		);
	});

	it("colors the collapsed Now Playing hover gutter from the active theme surface", () => {
		assert.match(
			scss,
			/\.Root__right-sidebar\s+:has\(>\s*\[inert\]\s+\.main-nowPlayingView-container\)\s*>\s*:first-child\s*>\s*\*\s*\{[^}]*background-color:\s*transparent;/s,
		);
	});

	it("ships as a patch release", () => {
		assert.equal(metadata.version, "1.5.3");
		assert.equal(kitPackage.spicetify.stdlibVersion, metadata.version);
	});
});
