import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
	AD_FETCHERS,
	AD_MANAGERS,
	AD_SLOT_IDS,
	AD_SURFACE_CSS,
	blockAdSlots,
	createAdSettingsClient,
	disableManager,
	enableManager,
	findWebpackServiceConstructor,
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
	it("uses the override when an older client still exposes it", async () => {
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

	it("hides Quicksilver in-app messages together with their modal overlay", () => {
		assert.match(UPSELL_CSS, /\[data-testid="inAppMessageContainer"\]/);
		assert.match(UPSELL_CSS, /\[data-testid="inAppMessageIframe"\]/);
		assert.match(UPSELL_CSS, /\[role="presentation"\]:has\(\[data-testid="inAppMessageContainer"\]\)/);
	});

	it("takes the whole modal portal down, not just the dialog inside it", () => {
		// Hiding only the dialog leaves the GenericModal backdrop (its
		// parent) as an invisible full-screen click blocker; seen live on
		// 1.2.96 as "a dark overlay blocking the app".
		assert.match(UPSELL_CSS, /\.ReactModalPortal:has\(\[data-testid="inAppMessageContainer"\]\)/);
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

	it("hides the Now Playing View from locale-independent player state", () => {
		assert.match(AD_SURFACE_CSS, /html\.spicetify-adblock-ad-playing \.main-nowPlayingView-mainWrapper/);
		assert.doesNotMatch(AD_SURFACE_CSS, /aria-label="Advertisement"/);
	});
});

describe("findWebpackServiceConstructor", () => {
	it("evaluates only the factory that declares the requested service", () => {
		const serviceId = "spotify.ads.esperanto.proto.Settings";
		class SettingsClient {
			static SERVICE_ID = serviceId;
		}
		const required: string[] = [];
		const runtime = Object.assign(
			(id: string) => {
				required.push(id);
				if (id !== "settings") throw new Error(`unexpected module ${id}`);
				return { SettingsClient };
			},
			{
				m: {
					unrelated: function unrelatedFactory() {},
					settings: function settingsFactory() {
						/* spotify.ads.esperanto.proto.Settings */
					},
				},
			},
		);

		assert.equal(findWebpackServiceConstructor(runtime, serviceId), SettingsClient);
		assert.deepEqual(required, ["settings"]);
	});

	it("returns null without evaluating anything when no factory matches", () => {
		let required = false;
		const runtime = Object.assign(
			() => {
				required = true;
			},
			{ m: { unrelated: function unrelatedFactory() {} } },
		);

		assert.equal(findWebpackServiceConstructor(runtime, "missing.service"), null);
		assert.equal(required, false);
	});
});

describe("createAdSettingsClient", () => {
	it("constructs the ads settings service with Spotify's product-state transport", () => {
		const serviceId = "spotify.ads.esperanto.proto.Settings";
		const transport = { request: () => {} };
		class SettingsClient {
			static SERVICE_ID = serviceId;
			readonly receivedTransport: unknown;
			constructor(receivedTransport: unknown) {
				this.receivedTransport = receivedTransport;
			}
		}
		const runtime = Object.assign(() => ({ SettingsClient }), {
			m: {
				settings: function settingsFactory() {
					/* spotify.ads.esperanto.proto.Settings */
				},
			},
		});

		const client = createAdSettingsClient(runtime, {
			UserAPI: { _product_state_service: { transport } },
		});

		assert.ok(client instanceof SettingsClient);
		assert.equal(client.receivedTransport, transport);
	});

	it("returns null when either the service or transport is unavailable", () => {
		const runtime = Object.assign(() => ({}), { m: {} });
		assert.equal(createAdSettingsClient(runtime, {}), null);
		assert.equal(createAdSettingsClient(undefined, {}), null);
	});
});

describe("blockAdSlots", () => {
	it("clears and disables every known slot, then restores its prior enabled state", async () => {
		const updates: Array<{ slotId: string; enabled: boolean }> = [];
		const cleared: string[] = [];
		const cancelled: string[] = [];
		const callbackDisabled = Promise.withResolvers<void>();
		let prerollDisables = 0;
		const callbacks = new Map<string, (event: { adSlotEvent?: { slotId?: string } }) => void>();
		const settings = {
			getSlotSettings: async ({ slotId }: { slotId: string }) => ({
				slotSettings: [{ id: slotId, enabled: slotId === "preroll" }],
			}),
			updateSlotEnabled: async (request: { slotId: string; enabled: boolean }) => {
				updates.push(request);
				if (request.slotId === "preroll" && !request.enabled && ++prerollDisables === 2) {
					callbackDisabled.resolve();
				}
			},
		};
		const connector = {
			clearSlot: (slotId: string) => void cleared.push(slotId),
			subscribeToSlot: (slotId: string, callback: (event: { adSlotEvent?: { slotId?: string } }) => void) => {
				callbacks.set(slotId, callback);
				return { cancel: () => void cancelled.push(slotId) };
			},
		};

		const restore = await blockAdSlots(connector, settings, ["preroll", "stream"]);

		assert.deepEqual(cleared, ["preroll", "stream"]);
		assert.deepEqual(updates, [
			{ slotId: "preroll", enabled: false },
			{ slotId: "stream", enabled: false },
		]);

		callbacks.get("preroll")?.({ adSlotEvent: { slotId: "preroll" } });
		await callbackDisabled.promise;
		assert.deepEqual(cleared, ["preroll", "stream", "preroll"]);
		assert.deepEqual(updates.at(-1), { slotId: "preroll", enabled: false });

		await restore();
		assert.deepEqual(cancelled, ["preroll", "stream"]);
		assert.deepEqual(updates.slice(-2), [
			{ slotId: "preroll", enabled: true },
			{ slotId: "stream", enabled: false },
		]);
	});

	it("covers Spotify's audio, display, and podcast slot families", () => {
		for (const slotId of ["preroll", "stream", "embedded-npv", "hpto", "podcast-midroll-1"]) {
			assert.ok(
				AD_SLOT_IDS.includes(slotId as never),
				`${slotId} must be disabled before it can fetch inventory`,
			);
		}
	});

	it("prioritizes audio slots before display inventory", () => {
		assert.deepEqual(AD_SLOT_IDS.slice(0, 2), ["preroll", "stream"]);
	});

	it("clears but never mutates a slot whose prior state cannot be restored", async () => {
		const cleared: string[] = [];
		const updates: Array<{ slotId: string; enabled: boolean }> = [];
		let callback: ((event: { adSlotEvent?: { slotId?: string } }) => void) | undefined;
		const restore = await blockAdSlots(
			{
				clearSlot: (slotId) => void cleared.push(slotId),
				subscribeToSlot: (_slotId, cb) => void (callback = cb),
			},
			{
				getSlotSettings: async () => ({ slotSettings: [] }),
				updateSlotEnabled: async (request) => void updates.push(request),
			},
			["not-created"],
		);

		callback?.({ adSlotEvent: { slotId: "not-created" } });
		await Promise.resolve();
		await restore();

		assert.deepEqual(cleared, ["not-created", "not-created"]);
		assert.deepEqual(updates, []);
	});

	it("waits for an in-flight callback before restoring, then ignores later events", async () => {
		const updates: Array<{ slotId: string; enabled: boolean }> = [];
		let callback: ((event: { adSlotEvent?: { slotId?: string } }) => void) | undefined;
		let releaseCallback = () => {};
		let markCallbackStarted = () => {};
		const callbackStarted = new Promise<void>((resolve) => void (markCallbackStarted = resolve));
		let updateCount = 0;
		const restore = await blockAdSlots(
			{
				clearSlot: () => {},
				subscribeToSlot: (_slotId, cb) => void (callback = cb),
			},
			{
				getSlotSettings: async ({ slotId }) => ({ slotSettings: [{ id: slotId, enabled: true }] }),
				updateSlotEnabled: async (request) => {
					updates.push(request);
					if (++updateCount === 2) {
						markCallbackStarted();
						await new Promise<void>((resolve) => void (releaseCallback = resolve));
					}
				},
			},
			["stream"],
		);

		callback?.({ adSlotEvent: { slotId: "stream" } });
		await callbackStarted;
		const restoring = restore();
		releaseCallback();
		await restoring;
		callback?.({ adSlotEvent: { slotId: "stream" } });
		await Promise.resolve();

		assert.deepEqual(updates, [
			{ slotId: "stream", enabled: false },
			{ slotId: "stream", enabled: false },
			{ slotId: "stream", enabled: true },
		]);
	});

	it("isolates a throwing cancellation handle so every state is restored", async () => {
		const updates: Array<{ slotId: string; enabled: boolean }> = [];
		const restore = await blockAdSlots(
			{
				clearSlot: () => {},
				subscribeToSlot: (slotId) => ({
					cancel: () => {
						if (slotId === "preroll") throw new Error("cancel failed");
					},
				}),
			},
			{
				getSlotSettings: async ({ slotId }) => ({ slotSettings: [{ id: slotId, enabled: true }] }),
				updateSlotEnabled: async (request) => void updates.push(request),
			},
			["preroll", "stream"],
		);

		await restore();
		assert.deepEqual(updates.slice(-2), [
			{ slotId: "preroll", enabled: true },
			{ slotId: "stream", enabled: true },
		]);
	});

	it("reuses an uncancellable listener across disable and re-enable cycles", async () => {
		let subscribeCalls = 0;
		let listener: ((event: { adSlotEvent?: { slotId?: string } }) => void) | undefined;
		let falseUpdates = 0;
		const callbackDisabled = Promise.withResolvers<void>();
		const connector = {
			clearSlot: () => {},
			subscribeToSlot: (_slotId: string, callback: typeof listener) => {
				subscribeCalls++;
				listener = callback;
			},
		};
		const settings = {
			getSlotSettings: async ({ slotId }: { slotId: string }) => ({
				slotSettings: [{ id: slotId, enabled: true }],
			}),
			updateSlotEnabled: async (request: { slotId: string; enabled: boolean }) => {
				if (!request.enabled && ++falseUpdates === 3) callbackDisabled.resolve();
			},
		};

		const restoreFirst = await blockAdSlots(connector, settings, ["stream"]);
		await restoreFirst();
		const restoreSecond = await blockAdSlots(connector, settings, ["stream"]);
		listener?.({ adSlotEvent: { slotId: "stream" } });
		await callbackDisabled.promise;

		assert.equal(subscribeCalls, 1);
		await restoreSecond();
	});

	it("preserves the original state when subscribing emits synchronously", async () => {
		const updates: Array<{ slotId: string; enabled: boolean }> = [];
		let reads = 0;
		const restore = await blockAdSlots(
			{
				clearSlot: () => {},
				subscribeToSlot: (slotId, callback) => {
					callback({ adSlotEvent: { slotId } });
					return { cancel: () => {} };
				},
			},
			{
				getSlotSettings: async ({ slotId }) => {
					reads++;
					await Promise.resolve();
					return { slotSettings: [{ id: slotId, enabled: updates.length === 0 }] };
				},
				updateSlotEnabled: async (request) => void updates.push(request),
			},
			["stream"],
		);

		await restore();
		assert.equal(reads, 1, "the initial and early-event paths must share one settings snapshot");
		assert.deepEqual(updates.at(-1), { slotId: "stream", enabled: true });
	});
});

describe("module lifecycle contract", () => {
	it("does not let a stale async restore undo a rapid re-enable", () => {
		const source = readFileSync(new URL("./mod.tsx", import.meta.url), "utf8");
		assert.match(source, /await setAdSlotBlocking\(false\);\s*if \(enabled\) return;/);
		assert.match(source, /ctx\.defer\(async \(\) => \{\s*enabled = false;\s*await restore\(\);/);
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
