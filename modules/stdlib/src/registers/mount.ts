/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// v3 registers mount without source transforms: instead of patching xpui to
// call __renderX(), a registry renders into a DOM anchor. The exposed React
// forwards to the client's own instance, so client components, stdlib
// chrome, and module components all share one hook dispatcher.

import { React, ReactDOM } from "../expose/React.ts";
import { warn } from "../logger.ts";
import { byOrder } from "./order.ts";
import type { Registry } from "./registry.ts";

export interface AnchorSpec {
	className: string;
	registry: Registry<any>;
	setRefresh: (cb: (() => void) | undefined) => void;
	// Position for the anchor; null means the client has not rendered the
	// slot yet and the mount should wait for it.
	findSlot: () => { parent: Element; before?: Node | null } | null;
	// Custom rendering over the registry items (e.g. route matching);
	// defaults to rendering every item.
	renderItems?: (items: any[]) => unknown;
	// The anchor host's display. Defaults to "contents" so the host is
	// layout-transparent and its items participate directly in the client
	// slot's layout. Set to a box value (e.g. "flex") when the items need
	// their own layout context instead of inheriting the slot's — so the
	// anchor counts as a single item in the slot and spaces its own children.
	hostDisplay?: string;
}

// One broken registered node must not take down the others.
export const createItemBoundary = (R: any, label: string) =>
	class ItemBoundary extends R.Component {
		state = { failed: false };
		static getDerivedStateFromError() {
			return { failed: true };
		}
		componentDidCatch(error: unknown) {
			console.error(`[stdlib] registered ${label} item crashed:`, error);
		}
		render() {
			return (this.state as { failed: boolean }).failed ? null : (this.props as { children?: unknown }).children;
		}
	};

// The top bar doubles as the window drag region; like the client's own
// buttons, anchor children must opt out or physical clicks drag the window
// instead of reaching them (synthetic and CDP clicks bypass this, so only
// real mice notice).
const ensureAnchorStyle = () => {
	if (document.getElementById("spicetify-anchor-style")) return;
	const style = document.createElement("style");
	style.id = "spicetify-anchor-style";
	style.textContent = "[data-spicetify-anchor] > * { -webkit-app-region: no-drag; app-region: no-drag; }";
	document.head.appendChild(style);
};

// One shared observer serves every anchor: the client mutates the DOM
// constantly, and per-anchor subtree observers multiply that cost. Each
// tick is one isConnected check per pending or placed anchor.
type WatchedAnchor = { host: HTMLElement; place: () => boolean; started: boolean; start: () => void };
const watched: WatchedAnchor[] = [];
let bodyObserver: MutationObserver | undefined;
const watchAnchor = (anchor: WatchedAnchor) => {
	watched.push(anchor);
	bodyObserver ??= (() => {
		const observer = new MutationObserver(() => {
			for (const a of watched) {
				if (a.host.isConnected) continue;
				if (a.place() && !a.started) {
					a.started = true;
					a.start();
				}
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		return observer;
	})();
};

export function mountRegistryAnchor(spec: AnchorSpec): void {
	// Transform experiments render through the injected __renderX() calls;
	// an anchor would double-render.
	if ((globalThis as never as Record<string, unknown>).__SPICETIFY_APPLY_TRANSFORMS__) return;
	if (typeof document === "undefined") return;

	void CHUNKS.xpui.promise.then(() => {
		const R = React as any;
		const createRoot = (ReactDOM as any).createRoot;
		if (typeof createRoot !== "function") {
			warn("[stdlib] cannot mount register anchor (no createRoot):", spec.className);
			return;
		}

		const host = document.createElement("span");
		host.className = spec.className;
		host.style.display = spec.hostDisplay ?? "contents";
		host.dataset.spicetifyAnchor = "";
		ensureAnchorStyle();

		const place = () => {
			const slot = spec.findSlot();
			if (!slot) return false;
			slot.parent.insertBefore(host, slot.before ?? null);
			return true;
		};

		const start = () => {
			const root = createRoot(host);
			const ItemBoundary = createItemBoundary(R, spec.className);
			const Wrapper = () => {
				const [, refresh] = R.useReducer((n: number) => n + 1, 0);
				R.useEffect(() => {
					spec.setRefresh(refresh);
					return () => spec.setRefresh(undefined);
				}, []);
				if (spec.renderItems) {
					return R.createElement(ItemBoundary, null, spec.renderItems(spec.registry.all()));
				}
				return R.createElement(
					R.Fragment,
					null,
					...byOrder(spec.registry.all()).map((item: unknown, i: number) =>
						R.createElement(ItemBoundary, { key: i }, item),
					),
				);
			};
			root.render(R.createElement(Wrapper));
		};

		const anchor: WatchedAnchor = { host, place, started: false, start };
		if (place()) {
			anchor.started = true;
			start();
		}
		// The shared observer both waits for a not-yet-rendered slot and
		// re-places the host whenever client reconciliation drops it; the
		// root stays attached to the node, so rendering survives.
		watchAnchor(anchor);
	});
}

// Mount a single element next to a specific client element (rather than into a
// fixed slot). Used by placeButton's `near` anchoring: the host is inserted
// before/after the resolved target and re-placed on client re-renders. If the
// target never appears within giveUpMs, onGiveUp() runs so the caller can fall
// back to ordinary placement — the button is never silently lost.
export interface AdjacentSpec {
	className: string;
	element: React.ReactNode;
	findTarget: () => Element | null;
	side: "before" | "after";
	giveUpMs: number;
	onGiveUp: () => void;
}

export function mountAdjacent(spec: AdjacentSpec): { remove: () => void } {
	let removed = false;
	let root: { render?: (node: unknown) => void; unmount?: () => void } | undefined;
	const host = document.createElement("span");
	host.className = spec.className;
	host.style.display = "contents";
	host.dataset.spicetifyAnchor = "";

	const place = (): boolean => {
		const target = spec.findTarget();
		if (!target?.parentElement) return false;
		const before = spec.side === "before" ? target : target.nextSibling;
		target.parentElement.insertBefore(host, before);
		return true;
	};

	const remove = () => {
		removed = true;
		root?.unmount?.();
		host.remove();
	};

	// Transform experiments render through injected __renderX() calls, and there
	// is no DOM off the client; in both cases fall back to ordinary placement.
	if (
		(globalThis as never as Record<string, unknown>).__SPICETIFY_APPLY_TRANSFORMS__ ||
		typeof document === "undefined"
	) {
		spec.onGiveUp();
		return { remove: () => {} };
	}

	void CHUNKS.xpui.promise.then(() => {
		if (removed) return;
		const R = React as any;
		const createRoot = (ReactDOM as any).createRoot;
		if (typeof createRoot !== "function") {
			spec.onGiveUp();
			return;
		}
		const start = () => {
			ensureAnchorStyle();
			root = createRoot(host);
			const ItemBoundary = createItemBoundary(R, spec.className);
			root!.render?.(R.createElement(ItemBoundary, null, spec.element));
		};

		const deadline = Date.now() + spec.giveUpMs;
		const attempt = () => {
			if (removed) return;
			if (place()) {
				start();
				// Reuse the shared observer for re-placement only (already started).
				watchAnchor({ host, place, started: true, start: () => {} });
				return;
			}
			if (Date.now() > deadline) {
				spec.onGiveUp();
				return;
			}
			setTimeout(attempt, 150);
		};
		attempt();
	});

	return { remove };
}
