import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { disableManager, enableManager, isEnabled } from "./logic.ts";

describe("disableManager", () => {
	it("prefers the client's own disable()", () => {
		let called = false;
		const m = { enabled: true, disable: () => { called = true; }, enable: () => {} };
		assert.equal(disableManager(m), true);
		assert.equal(called, true, "disable() unsubscribes; writing the flag does not");
	});

	it("falls back to the enabled flag when there is no disable()", () => {
		const m = { enabled: true };
		assert.equal(disableManager(m), true);
		assert.equal(m.enabled, false);
	});

	it("reports false for an already-disabled manager so it is not restored", () => {
		const m = { enabled: false, disable: () => {} };
		assert.equal(disableManager(m), false);
	});

	it("tolerates a missing manager", () => {
		assert.equal(disableManager(undefined), false);
	});
});

describe("isEnabled", () => {
	it("treats a missing flag as on", () => {
		assert.equal(isEnabled({}), true);
		assert.equal(isEnabled({ enabled: false }), false);
	});
});

describe("enableManager", () => {
	it("restores through enable() when present", () => {
		let called = false;
		enableManager({ enabled: false, enable: () => { called = true; } });
		assert.equal(called, true);
	});

	it("restores the flag otherwise", () => {
		const m = { enabled: false };
		enableManager(m);
		assert.equal(m.enabled, true);
	});
});
