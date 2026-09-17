import assert from "node:assert/strict";
import { test } from "node:test";
import { managedJobMessage } from "./managedSpotifyState.ts";

test("managed progress describes package preparation without claiming native blocking", () => {
	assert.match(managedJobMessage({ kind: "running", jobId: "one", phase: "preparing" }) ?? "", /Preparing Spotify/);
	assert.match(managedJobMessage({ kind: "running", jobId: "one", phase: "activating" }) ?? "", /restart/);
	assert.doesNotMatch(managedJobMessage({ kind: "complete", jobId: "one" }) ?? "", /block/i);
	assert.match(
		managedJobMessage({ kind: "failed", jobId: "one", message: "checksum mismatch" }) ?? "",
		/checksum mismatch/,
	);
});
