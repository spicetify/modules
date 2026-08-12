import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { retryNotice } from "./notice.ts";

describe("retryNotice", () => {
	it("finishes immediately when Snackbar is already ready", () => {
		let scheduled = false;
		retryNotice(() => true, (() => {
			scheduled = true;
			return 1 as never;
		}) as never);
		assert.equal(scheduled, false);
	});

	it("retries until a late Snackbar becomes ready and then cancels", () => {
		let tick = () => {};
		let attempts = 0;
		let cancelled = 0;
		const dispose = retryNotice(
			() => ++attempts >= 3,
			((callback: () => void) => {
				tick = callback;
				return 1 as never;
			}) as never,
			(() => {
				cancelled += 1;
			}) as never,
		);
		assert.equal(attempts, 1, "the first attempt is immediate");
		tick();
		assert.equal(cancelled, 0);
		tick();
		assert.equal(cancelled, 1);
		dispose();
		assert.equal(cancelled, 2, "effect cleanup remains safe after success");
	});
});
