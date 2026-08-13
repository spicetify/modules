import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const css = await readFile(new URL("../themes/dreary/index.css", import.meta.url), "utf8");
const metadata = JSON.parse(await readFile(new URL("../themes/dreary/metadata.json", import.meta.url), "utf8"));

describe("dreary current-client compatibility", () => {
	it("lets Spotify's library state own the left-sidebar width", () => {
		assert.doesNotMatch(css, /\.Root__nav-bar\s*\{[^}]*min-width\s*:/s);
	});

	it("ships as a patch release", () => {
		assert.equal(metadata.version, "0.1.1");
	});
});
