import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareSpotifyVersions, effectiveSupport, updateAdvice } from "./state.ts";

describe("compareSpotifyVersions", () => {
	it("orders numeric dotted versions", () => {
		assert.ok(compareSpotifyVersions("1.2.95.100", "1.2.94.583") > 0);
		assert.ok(compareSpotifyVersions("1.2.94.583", "1.2.95.100") < 0);
		assert.equal(compareSpotifyVersions("1.2.94.583", "1.2.94.583"), 0);
	});

	it("ignores git suffixes and missing segments", () => {
		assert.equal(compareSpotifyVersions("1.2.94.583.gdeadbeef", "1.2.94.583"), 0);
		assert.ok(compareSpotifyVersions("1.2.94", "1.2.94.583") < 0);
	});
});

describe("updateAdvice", () => {
	it("is unknown without an installed version or feed", () => {
		assert.equal(updateAdvice(undefined, { latestSpotify: "1.2.95" }).kind, "unknown");
		assert.equal(updateAdvice("1.2.94", null).kind, "unknown");
	});

	it("is current when the latest known build is not newer than installed", () => {
		assert.equal(updateAdvice("1.2.95.100", { latestSpotify: "1.2.95.100" }).kind, "current");
		assert.equal(updateAdvice("1.2.96.0", { latestSpotify: "1.2.95.100" }).kind, "current");
	});

	it("is ready when a newer build exists and is supported", () => {
		const a = updateAdvice("1.2.94.583", { latestSpotify: "1.2.95.100", supportedSpotify: "1.2.95.100" });
		assert.equal(a.kind, "ready");
		assert.ok(a.message.length > 0);
	});

	it("is waiting when a newer build exists but is not yet supported", () => {
		const a = updateAdvice("1.2.94.583", { latestSpotify: "1.2.95.100", supportedSpotify: "1.2.94.583" });
		assert.equal(a.kind, "waiting");
		assert.ok(a.message.length > 0);
	});

	it("is unsupported when installed is newer than the newest supported build", () => {
		const a = updateAdvice("1.2.95.100", { latestSpotify: "1.2.95.100", supportedSpotify: "1.2.94.583" });
		assert.equal(a.kind, "unsupported");
		assert.ok(a.message.includes("1.2.95.100"));
	});

	it("does not raise a false unsupported alarm when the feed is unavailable", () => {
		assert.notEqual(updateAdvice("1.2.95.100", null).kind, "unsupported");
		assert.notEqual(updateAdvice("1.2.95.100", { latestSpotify: "1.2.95.100" }).kind, "unsupported");
	});
});

describe("effectiveSupport", () => {
	it("takes supported from the manifest (local applicability) and latest from the live feed", () => {
		const merged = effectiveSupport(
			{ supportedSpotify: "1.2.94.583", latestSpotify: "1.2.90.0" },
			{ supportedSpotify: "1.2.96.0", latestSpotify: "1.2.95.100" },
		);
		assert.equal(merged?.supportedSpotify, "1.2.94.583"); // manifest wins for supported
		assert.equal(merged?.latestSpotify, "1.2.95.100"); // feed wins for latest
	});

	it("falls back to the manifest for latest when the feed is unavailable", () => {
		const merged = effectiveSupport({ supportedSpotify: "1.2.94.583", latestSpotify: "1.2.95.100" }, null);
		assert.equal(merged?.supportedSpotify, "1.2.94.583");
		assert.equal(merged?.latestSpotify, "1.2.95.100");
	});

	it("falls back to the feed for supported when the manifest lacks it (older CLI)", () => {
		const merged = effectiveSupport({ latestSpotify: "1.2.90.0" }, { supportedSpotify: "1.2.94.583", latestSpotify: "1.2.95.100" });
		assert.equal(merged?.supportedSpotify, "1.2.94.583");
		assert.equal(merged?.latestSpotify, "1.2.95.100");
	});

	it("returns the feed unchanged when there is nothing to merge", () => {
		assert.equal(effectiveSupport({}, null), null);
	});
});
