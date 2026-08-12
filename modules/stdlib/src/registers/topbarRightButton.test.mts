import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./topbarRightButton.tsx", import.meta.url), "utf8");

describe("TopbarRightButton", () => {
	it("uses the component library icon-only contract for a native 32px hitbox", () => {
		assert.match(source, /size="small"/);
		assert.match(source, /iconOnly=/);
		assert.doesNotMatch(source, /condensedAll/);
	});
});
