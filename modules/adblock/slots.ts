/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const AD_SETTINGS_SERVICE_ID = "spotify.ads.esperanto.proto.Settings";

// Spotify 1.2.96 removed the ad connector's override skip. Blocking now has
// to happen before inventory reaches the player, across every slot family the
// client declares. Keep these semantic ids in sync with AdsCore slot ids.
export const AD_SLOT_IDS = [
	"preroll",
	"stream",
	"embedded-npv",
	"embedded-playlist-leavebehind",
	"embedded-playlist",
	"hpto",
	"leaderboard",
	"podcast-midroll-1",
	"podcast-midroll-2",
	"podcast-midroll-3",
	"podcast-midroll-4",
	"podcast-midroll-5",
	"podcast-postroll",
	"podcast-preroll",
] as const;

type WebpackRuntime = ((id: string) => unknown) & { m: Record<string, unknown> };
type ServiceConstructor<T> = { new (transport: unknown): T; SERVICE_ID?: string };

/** Finds one service while evaluating only the matching webpack module. */
export function findWebpackServiceConstructor<T>(
	runtime: WebpackRuntime | undefined,
	serviceId: string,
): ServiceConstructor<T> | null {
	if (!runtime?.m) return null;
	for (const [id, factory] of Object.entries(runtime.m)) {
		if (typeof factory !== "function" || !String(factory).includes(serviceId)) continue;
		let exported: unknown;
		try {
			exported = runtime(id);
		} catch {
			continue;
		}
		const candidates = [exported, ...(exported && typeof exported === "object" ? Object.values(exported) : [])];
		for (const candidate of candidates) {
			if (typeof candidate === "function" && (candidate as { SERVICE_ID?: string }).SERVICE_ID === serviceId) {
				return candidate as ServiceConstructor<T>;
			}
		}
	}
	return null;
}

type ProductStatePlatform = {
	UserAPI?: {
		_product_state?: { transport?: unknown };
		_product_state_service?: { transport?: unknown };
	};
	ProductStateAPI?: { productStateApi?: { transport?: unknown } };
};

/** Creates Spotify's ads settings client from the live product-state transport. */
export function createAdSettingsClient(
	runtime: WebpackRuntime | undefined,
	platform: ProductStatePlatform | undefined,
): AdSlotSettingsClient | null {
	const transport =
		platform?.UserAPI?._product_state_service?.transport ??
		platform?.UserAPI?._product_state?.transport ??
		platform?.ProductStateAPI?.productStateApi?.transport;
	if (!transport) return null;
	const Constructor = findWebpackServiceConstructor<AdSlotSettingsClient>(runtime, AD_SETTINGS_SERVICE_ID);
	return Constructor ? new Constructor(transport) : null;
}

type AdSlotEvent = { adSlotEvent?: { slotId?: string } };
type AdSlotSubscription = { cancel?: () => void; unsubscribe?: () => void };
type SlotHandler = (slotId: string) => void;

export type AdSlotConnector = {
	clearSlot?: (slotId: string) => unknown;
	subscribeToSlot?: (slotId: string, callback: (event: AdSlotEvent) => void) => AdSlotSubscription | void;
};

export type AdSlotSettingsClient = {
	getSlotSettings: (request: { slotId: string }) => Promise<{
		slotSettings?: Array<{ id?: string; enabled?: boolean }>;
	}>;
	updateSlotEnabled: (request: { slotId: string; enabled: boolean }) => Promise<unknown>;
};

type PersistentWatcher = { handler: SlotHandler | null };
const persistentWatchers = new WeakMap<AdSlotConnector, Map<string, PersistentWatcher>>();

/** Reuses listeners on builds whose subscription API exposes no cancellation handle. */
function watchAdSlot(connector: AdSlotConnector, slotId: string, handler: SlotHandler): AdSlotSubscription | undefined {
	if (typeof connector.subscribeToSlot !== "function") return;
	const watchers = persistentWatchers.get(connector);
	const existing = watchers?.get(slotId);
	if (existing) {
		existing.handler = handler;
		return { cancel: () => (existing.handler = null) };
	}

	const watcher: PersistentWatcher = { handler };
	const subscription = connector.subscribeToSlot(slotId, (event) => {
		watcher.handler?.(event.adSlotEvent?.slotId ?? slotId);
	});
	if (subscription) return subscription;

	const retained = watchers ?? new Map<string, PersistentWatcher>();
	retained.set(slotId, watcher);
	persistentWatchers.set(connector, retained);
	return { cancel: () => (watcher.handler = null) };
}

// A cosmos request through the connector can simply never settle (the ad
// session may be torn down under it), and an unbounded await here hangs the
// loader's unload: the store then shows "installing…" forever while the old
// instance's dispose waits on a reply that is not coming. Every slot call
// is therefore raced against a deadline and treated as answered-empty when
// it misses it.
export const SLOT_CALL_TIMEOUT_MS = 4000;

export function bounded<T>(work: T | Promise<T> | null | undefined, label: string): Promise<Awaited<T> | undefined> {
	if (work == null) return Promise.resolve(undefined);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			console.warn(`[adblock] ${label} did not answer within ${SLOT_CALL_TIMEOUT_MS}ms; continuing`);
			resolve(undefined);
		}, SLOT_CALL_TIMEOUT_MS);
		Promise.resolve(work).then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				console.warn(`[adblock] ${label} failed`, error);
				resolve(undefined);
			},
		);
	});
}

async function clearAdSlot(connector: AdSlotConnector, slotId: string): Promise<void> {
	await bounded(connector.clearSlot?.(slotId), `clearSlot(${slotId})`);
}

/** Disables ad inventory at its source and returns an exact state restorer. */
export async function blockAdSlots(
	connector: AdSlotConnector,
	settings: AdSlotSettingsClient,
	slotIds: readonly string[] = AD_SLOT_IDS,
): Promise<() => Promise<void>> {
	const previousStates = new Map<string, boolean>();
	const stateReads = new Map<string, Promise<void>>();
	const subscriptions: AdSlotSubscription[] = [];
	const inFlight = new Set<Promise<void>>();
	let active = true;

	const readPreviousState = async (slotId: string) => {
		if (previousStates.has(slotId)) return;
		const existing = stateReads.get(slotId);
		if (existing) return existing;

		const read = (async () => {
			const response = await bounded(settings.getSlotSettings({ slotId }), `getSlotSettings(${slotId})`);
			const state = response?.slotSettings?.find((entry) => entry.id === slotId) ?? response?.slotSettings?.[0];
			if (!previousStates.has(slotId) && typeof state?.enabled === "boolean") {
				previousStates.set(slotId, state.enabled);
			}
		})();
		stateReads.set(slotId, read);
		await read;
		if (stateReads.get(slotId) === read) stateReads.delete(slotId);
	};

	const disable = async (slotId: string) => {
		await clearAdSlot(connector, slotId);
		if (!active) return;
		await readPreviousState(slotId);
		if (!active || !previousStates.has(slotId)) return;
		await bounded(settings.updateSlotEnabled({ slotId, enabled: false }), `updateSlotEnabled(${slotId})`);
	};

	const track = (operation: Promise<void>) => {
		inFlight.add(operation);
		void operation.finally(() => inFlight.delete(operation));
	};

	await Promise.all(
		slotIds.map(async (slotId) => {
			try {
				const subscription = watchAdSlot(connector, slotId, (eventSlotId) => {
					if (active) track(disable(eventSlotId));
				});
				if (subscription) subscriptions.push(subscription);
			} catch (error) {
				console.warn(`[adblock] could not watch slot ${slotId}`, error);
			}
			await disable(slotId);
		}),
	);

	return async () => {
		active = false;
		for (const subscription of subscriptions) {
			try {
				if (typeof subscription.cancel === "function") subscription.cancel();
				else subscription.unsubscribe?.();
			} catch (error) {
				console.warn("[adblock] could not cancel a slot subscription", error);
			}
		}
		await bounded(Promise.allSettled(inFlight), "draining in-flight slot calls");
		await Promise.all(
			[...previousStates].map(([slotId, enabled]) =>
				bounded(settings.updateSlotEnabled({ slotId, enabled }), `restoreSlot(${slotId})`),
			),
		);
	};
}
