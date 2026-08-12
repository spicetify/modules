import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	compareSpotifyVersions,
	deriveStaleStaged,
	describeAction,
	effectiveSupport,
	latestPublishedVersions,
	spotifyVersionLine,
	updateAdvice,
	type ManagerModuleRow,
} from "./state.ts";

describe("compareSpotifyVersions", () => {
	it("orders numeric dotted versions", () => {
		assert.ok(compareSpotifyVersions("1.2.95.100", "1.2.94.583") > 0);
		assert.ok(compareSpotifyVersions("1.2.94.583", "1.2.95.100") < 0);
		assert.equal(compareSpotifyVersions("1.2.94.583", "1.2.94.583"), 0);
	});

	it("ignores git suffixes and missing segments", () => {
		assert.equal(compareSpotifyVersions("1.2.94.583.gdeadbeef", "1.2.94.583"), 0);
		assert.equal(
			compareSpotifyVersions("1.2.94", "1.2.94.583"),
			0,
			"older manifests can carry a three-part version, so a less precise read must not rank below it",
		);
		assert.ok(compareSpotifyVersions("1.2.93", "1.2.94.583") < 0, "a genuinely older build still compares older");
		assert.equal(compareSpotifyVersions("1.2.96.518", "1.2.96.999"), 0);
	});
});

describe("spotifyVersionLine", () => {
	it("always discards the fourth component", () => {
		assert.equal(spotifyVersionLine("1.2.96.518"), "1.2.96");
		assert.equal(spotifyVersionLine("1.2.96"), "1.2.96");
		assert.equal(spotifyVersionLine("not-a-version"), undefined);
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
		assert.ok(a.message.includes("1.2.95"));
	});

	it("does not raise a false unsupported alarm when the feed is unavailable", () => {
		assert.notEqual(updateAdvice("1.2.95.100", null).kind, "unsupported");
		assert.notEqual(updateAdvice("1.2.95.100", { latestSpotify: "1.2.95.100" }).kind, "unsupported");
	});
});

describe("effectiveSupport", () => {
	it("takes support from the classmaps index and availability from the live feed", () => {
		const merged = effectiveSupport(
			{
				spotifyVersion: "1.2.94.583",
				classmapSpotify: "1.2.94.583",
				classmapVerified: true,
				supportedSpotify: "1.2.95.100",
			},
			{ latestSpotify: "1.2.96.10" },
		);
		assert.equal(merged?.installedSupported, true);
		assert.equal(merged?.supportedSpotify, "1.2.95");
		assert.equal(merged?.latestSpotify, "1.2.96");
	});

	it("uses verified classmaps as availability evidence when the feed is unavailable", () => {
		const merged = effectiveSupport(
			{
				spotifyVersion: "1.2.94.583",
				classmapSpotify: "1.2.94.583",
				classmapVerified: true,
				supportedSpotify: "1.2.95.100",
			},
			null,
		);
		assert.equal(merged?.installedSupported, true);
		assert.equal(merged?.latestSpotify, "1.2.95");
	});

	it("does not infer verification from an exact map in an older manifest", () => {
		const merged = effectiveSupport({ spotifyVersion: "1.2.96.518" }, { latestSpotify: "1.2.94.583" });
		assert.equal(merged?.installedSupported, undefined);
		assert.equal(merged?.supportedSpotify, undefined);
		assert.equal(merged?.latestSpotify, "1.2.96", "available cannot predate the installed build");
	});

	it("marks a fallback classmap as not supporting the installed build", () => {
		const merged = effectiveSupport(
			{
				spotifyVersion: "1.2.96.518",
				classmapSpotify: "1.2.94.583",
				classmapVerified: false,
				supportedSpotify: "1.2.94.583",
			},
			null,
		);
		assert.equal(merged?.installedSupported, false);
		assert.equal(updateAdvice("1.2.96.518", merged).kind, "unsupported");
	});

	it("marks a current-CLI exact but unverified classmap as unsupported", () => {
		const merged = effectiveSupport(
			{
				spotifyVersion: "1.2.97.10",
				classmapVerified: false,
				supportedSpotify: "1.2.96.518",
			},
			null,
		);
		assert.equal(merged?.installedSupported, false);
		assert.equal(updateAdvice("1.2.97.10", merged).kind, "unsupported");
	});

	it("rejects an unverified selected map even when its build is indexed as supported", () => {
		const merged = effectiveSupport(
			{
				spotifyVersion: "1.2.96.518",
				classmapVerified: false,
				supportedSpotify: "1.2.96.518",
			},
			null,
		);
		assert.equal(merged?.installedSupported, false);
		assert.equal(updateAdvice("1.2.96.518", merged).kind, "unsupported");
	});

	it("can declare a future Spotify update ready before it is installed", () => {
		const merged = effectiveSupport(
			{
				spotifyVersion: "1.2.96.518",
				classmapSpotify: "1.2.96.518",
				classmapVerified: true,
				supportedSpotify: "1.2.97.10",
			},
			{ latestSpotify: "1.2.97.10" },
		);
		assert.equal(updateAdvice("1.2.96.518", merged).kind, "ready");
	});

	it("returns the feed unchanged when there is nothing to merge", () => {
		assert.equal(effectiveSupport({}, null), null);
	});
});

describe("latestPublishedVersions", () => {
	it("picks the newest version key per module", () => {
		const vault = {
			modules: {
				stdlib: { v: { "1.0.0": {}, "1.1.2": {}, "1.1.0": {} } },
				solo: { v: { "0.1.0": {} } },
			},
		};
		assert.deepEqual(latestPublishedVersions(vault), { stdlib: "1.1.2", solo: "0.1.0" });
	});

	it("orders numerically, not lexically", () => {
		assert.deepEqual(latestPublishedVersions({ modules: { m: { v: { "0.9.0": {}, "0.10.0": {} } } } }), {
			m: "0.10.0",
		});
	});

	it("skips malformed entries instead of throwing", () => {
		const vault = { modules: { ok: { v: { "1.0.0": {} } }, noV: {}, weird: { v: null } } };
		assert.deepEqual(latestPublishedVersions(vault), { ok: "1.0.0" });
		assert.deepEqual(latestPublishedVersions(null), {});
		assert.deepEqual(latestPublishedVersions({ modules: "nope" }), {});
	});
});

describe("deriveStaleStaged", () => {
	const row = (id: string, version: string, source: "staged" | "local"): ManagerModuleRow => ({
		id,
		version,
		source,
		loaded: true,
		mixedIn: false,
		dependencies: {},
	});

	it("flags a staged module strictly behind the vault", () => {
		const out = deriveStaleStaged([row("stdlib", "1.0.0", "staged")], { stdlib: "1.1.2" });
		assert.deepEqual(out, [{ id: "stdlib", staged: "1.0.0", published: "1.1.2" }]);
	});

	it("leaves current and ahead-of-vault staged modules alone", () => {
		const published = { stdlib: "1.1.2" };
		assert.deepEqual(deriveStaleStaged([row("stdlib", "1.1.2", "staged")], published), []);
		// A dev running an unpublished build is ahead, not stale.
		assert.deepEqual(deriveStaleStaged([row("stdlib", "1.2.0", "staged")], published), []);
	});

	it("ignores local installs and modules absent from the vault", () => {
		const out = deriveStaleStaged([row("store", "1.0.0", "local"), row("private-thing", "0.0.1", "staged")], {
			store: "1.1.0",
		});
		assert.deepEqual(out, []);
	});
});

describe("describeAction", () => {
	it("reports a plain success", () => {
		assert.equal(describeAction("remove mod", undefined), "remove mod done");
	});

	it("names the version a revert-to-staged left running", () => {
		assert.equal(
			describeAction("remove hide-window-controls", { revertedTo: "0.1.0" }),
			"remove hide-window-controls: reverted to the CLI-installed 0.1.0",
		);
	});

	it("asks for a restart when the loader could not swap live", () => {
		assert.equal(
			describeAction("remove stdlib", { requiresRestart: true }),
			"remove stdlib done — restart Spotify to finish",
		);
	});
});
