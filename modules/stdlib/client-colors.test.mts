import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const metadata = JSON.parse(await readFile(new URL("./metadata.json", import.meta.url), "utf8"));
const kitPackage = JSON.parse(await readFile(new URL("../../packages/kit/package.json", import.meta.url), "utf8"));

describe("shared client colour bridge", () => {
	it("keeps the kit compatibility target aligned with stdlib", () => {
		assert.equal(kitPackage.spicetify.stdlibVersion, metadata.version);
	});
});
