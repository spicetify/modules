import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { disableManager, enableManager, injectStyle, isAdItem, isEnabled, skipAd, UPSELL_CSS } from "./logic.ts";

describe("disableManager", () => {
	it("prefers the client's own disable()", () => {
		let called = false;
		const m = {
			enabled: true,
			disable: () => {
				called = true;
			},
			enable: () => {},
		};
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
		enableManager({
			enabled: false,
			enable: () => {
				called = true;
			},
		});
		assert.equal(called, true);
	});

	it("restores the flag otherwise", () => {
		const m = { enabled: false };
		enableManager(m);
		assert.equal(m.enabled, true);
	});
});

describe("isAdItem", () => {
	it("catches an ad by uri, type, or metadata flag independently", () => {
		assert.equal(isAdItem({ uri: "spotify:ad:bfa94d1f" }), true);
		assert.equal(isAdItem({ type: "ad" }), true);
		assert.equal(isAdItem({ metadata: { is_advertisement: "true" } }), true);
	});

	it("leaves ordinary tracks alone", () => {
		assert.equal(isAdItem({ uri: "spotify:track:60Z9I8Yqy6", type: "track" }), false);
		assert.equal(isAdItem(undefined), false);
		assert.equal(isAdItem(null), false);
	});
});

describe("skipAd", () => {
	it("uses the ads connector override, which is what the client accepts mid-ad", async () => {
		let called = 0;
		assert.equal(await skipAd({ skipToNextWithOverride: async () => void called++ }), true);
		assert.equal(called, 1);
	});

	it("reports failure instead of throwing when the client refuses", async () => {
		assert.equal(
			await skipAd({
				skipToNextWithOverride: () => Promise.reject(new Error("nope")),
			}),
			false,
		);
	});

	it("reports failure when the connector is absent", async () => {
		assert.equal(await skipAd(undefined), false);
		assert.equal(await skipAd({}), false);
	});
});

describe("UPSELL_CSS", () => {
	it("targets premium links by destination, not by hashed class names", () => {
		assert.match(UPSELL_CSS, /a\[href\*="\/premium"\]/);
	});

	it("hides the row as well as the link so no blank menu entry is left", () => {
		assert.match(UPSELL_CSS, /li:has\(> a\[href\*="\/premium"\]\)/);
	});
});

describe("injectStyle", () => {
	it("replaces a previous copy instead of stacking styles", () => {
		const nodes: Record<string, { id: string; textContent: string; remove: () => void }> = {};
		const doc = {
			getElementById: (id: string) => nodes[id] ?? null,
			createElement: () => ({ id: "", textContent: "", remove: () => {} }) as never,
			head: {
				appendChild: (n: { id: string; textContent: string }) => {
					nodes[n.id] = { ...n, remove: () => delete nodes[n.id] } as never;
				},
			},
		};
		(globalThis as { document?: unknown }).document = doc;

		const remove = injectStyle("x", "a{}");
		injectStyle("x", "b{}");
		assert.equal(Object.keys(nodes).length, 1, "a second injection must not stack a second tag");
		remove();
		assert.deepEqual(Object.keys(nodes), []);
		delete (globalThis as { document?: unknown }).document;
	});
});
