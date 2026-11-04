import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { displayNameFor, displayNameIssue, moduleIdOf } from "../src/module-id.ts";

describe("moduleIdOf", () => {
	it("reads id when metadata declares one, whatever the display name", () => {
		assert.equal(moduleIdOf({ name: "Full App Display", id: "full-app-display" }), "full-app-display");
	});

	it("falls back to name for metadata from before ids existed", () => {
		assert.equal(moduleIdOf({ name: "full-app-display" }), "full-app-display");
	});

	it("does not fall back to a display name when the id is unusable", () => {
		assert.equal(moduleIdOf({ name: "Full App Display", id: "" }), undefined);
		assert.equal(moduleIdOf({ name: "Full App Display", id: 3 }), undefined);
	});

	it("has nothing to read from a non-object", () => {
		assert.equal(moduleIdOf(null), undefined);
		assert.equal(moduleIdOf("full-app-display"), undefined);
	});
});

describe("displayNameFor", () => {
	it("title-cases each part of the id", () => {
		assert.equal(displayNameFor("full-app-display"), "Full App Display");
		assert.equal(displayNameFor("text"), "Text");
	});
});

describe("displayNameIssue", () => {
	it("accepts Latin names, accents included", () => {
		assert.equal(displayNameIssue("Full App Display"), undefined);
		assert.equal(displayNameIssue("Pokémon Adventure"), undefined);
		assert.equal(displayNameIssue("Shuffle+"), undefined);
	});

	it("refuses lookalike, invisible and control characters", () => {
		assert.ok(displayNameIssue("Lyr\u0456cs Plus"));
		assert.ok(displayNameIssue("Lyrics\u200bPlus"));
		assert.ok(displayNameIssue("Lyrics\u202ePlus"));
		assert.ok(displayNameIssue("Tab\tName"));
		assert.ok(displayNameIssue("+++"));
		assert.ok(displayNameIssue(""));
	});
});
