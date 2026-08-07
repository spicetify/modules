import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	AD_FETCHERS,
	AD_MANAGERS,
	AD_SURFACE_CSS,
	disableManager,
	enableManager,
	injectStyle,
	isAdItem,
	isEnabled,
	resolveManager,
	skipAd,
	stubFetcher,
	UPSELL_CSS,
} from "./logic.ts";

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

describe("resolveManager", () => {
	it("reaches a manager nested one level down, where the disable actually lives", () => {
		const disable = () => {};
		const root = { embeddedAd: { embeddedAdManager: { disable } } };
		assert.equal(resolveManager(root, "embeddedAd.embeddedAdManager"), root.embeddedAd.embeddedAdManager);
	});

	it("returns undefined for a gap instead of throwing", () => {
		assert.equal(resolveManager({}, "vto.manager"), undefined);
		assert.equal(resolveManager(undefined, "audio"), undefined);
	});

	it("covers every surface whose control is not on the outer object", () => {
		for (const path of ["vto.manager", "embeddedAd.embeddedAdManager"]) {
			assert.ok(AD_MANAGERS.includes(path as never), `${path} must be addressed by its nested path`);
		}
	});
});

describe("disableManager, leaderboard shape", () => {
	it("uses disableLeaderboard when that is the only control", () => {
		let called = false;
		const m = {
			enabled: true,
			disableLeaderboard: () => {
				called = true;
			},
		};
		assert.equal(disableManager(m), true);
		assert.equal(called, true, "writing the flag alone leaves the leaderboard subscribed");
	});
});

describe("AD_SURFACE_CSS", () => {
	it("hides rendered ads by testid, since disabling a manager only stops the next one", () => {
		assert.match(AD_SURFACE_CSS, /\[data-testid="embedded-ad"\]/);
		assert.match(AD_SURFACE_CSS, /\[data-testid="ad-companion-card"\]/);
	});

	it("hides the home ad shelf, which no manager can turn off", () => {
		assert.match(AD_SURFACE_CSS, /\[data-testid="home-ads-container"\]/);
	});
});

describe("stubFetcher", () => {
	it("stops the fetch that would deliver the ad", async () => {
		let called = 0;
		const m = {
			fetchHomeAd: async () => {
				called++;
				return { ad: "lidl" };
			},
		};
		const restore = stubFetcher(m, "fetchHomeAd");
		assert.equal(await m.fetchHomeAd(), null, "an empty result renders no card");
		assert.equal(called, 0, "the ad must never be requested");
		assert.ok(restore);
	});

	it("hands the original function back on restore", async () => {
		const original = async () => ({ ad: "lidl" });
		const m = { fetchHomeAd: original };
		stubFetcher(m, "fetchHomeAd")?.();
		assert.equal(m.fetchHomeAd, original);
		assert.deepEqual(await m.fetchHomeAd(), { ad: "lidl" });
	});

	it("reports nothing to restore when the build has no such method", () => {
		assert.equal(stubFetcher({}, "fetchHomeAd"), null);
		assert.equal(stubFetcher(undefined, "fetchHomeAd"), null);
		assert.equal(stubFetcher({ fetchHomeAd: "not a function" } as never, "fetchHomeAd"), null);
	});
});

describe("AD_FETCHERS", () => {
	it("covers home, whose manager exposes neither disable nor enabled", () => {
		assert.ok(AD_FETCHERS.some((f) => f.path === "home" && f.method === "fetchHomeAd"));
	});

	it("leaves a fetch-driven surface untouched by disableManager", () => {
		// The real shape of Platform.AdManagers.home: no disable, no enabled, so
		// disableManager does nothing and reports false. This is why the stub exists.
		const home = { logger: {}, fetchHomeAd: async () => ({}), enableLegacyHptoContainerLoader: true };
		assert.equal(disableManager(home as never), false);
	});
});
