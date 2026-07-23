/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// v3 registers mount without source transforms: instead of patching xpui to
// call __renderX(), a registry renders into a DOM anchor. The exposed React
// forwards to the client's own instance, so client components, stdlib
// chrome, and module components all share one hook dispatcher.

import { React, ReactDOM } from "../expose/React.ts";
import type { Registry } from "./registry.ts";

export interface AnchorSpec {
	className: string;
	registry: Registry<any>;
	setRefresh: (cb: (() => void) | undefined) => void;
	// Position for the anchor; null means the client has not rendered the
	// slot yet and the mount should wait for it.
	findSlot: () => { parent: Element; before?: Node | null } | null;
}

export function mountRegistryAnchor(spec: AnchorSpec): void {
	// Transform experiments render through the injected __renderX() calls;
	// an anchor would double-render.
	if ((globalThis as never as Record<string, unknown>).__SPICETIFY_APPLY_TRANSFORMS__) return;
	if (typeof document === "undefined") return;

	void CHUNKS.xpui.promise.then(() => {
		const R = React as any;
		const createRoot = (ReactDOM as any).createRoot;
		if (typeof createRoot !== "function") {
			console.warn("[stdlib] cannot mount register anchor (no createRoot):", spec.className);
			return;
		}

		const host = document.createElement("span");
		host.className = spec.className;
		host.style.display = "contents";

		const place = () => {
			const slot = spec.findSlot();
			if (!slot) return false;
			slot.parent.insertBefore(host, slot.before ?? null);
			return true;
		};

		const start = () => {
			// The client re-renders its own tree and can drop foreign
			// children; re-insert the anchor whenever that happens. The root
			// stays attached to the node, so rendering survives re-insertion.
			const keeper = new MutationObserver(() => {
				if (!host.isConnected) place();
			});
			keeper.observe(document.body, { childList: true, subtree: true });

			const root = createRoot(host);
			// One broken registered node must not take down the others.
			class ItemBoundary extends R.Component {
				override state = { failed: false };
				static getDerivedStateFromError() {
					return { failed: true };
				}
				override componentDidCatch(error: unknown) {
					console.error(`[stdlib] registered ${spec.className} item crashed:`, error);
				}
				override render() {
					return (this.state as { failed: boolean }).failed ? null : (this.props as { children?: unknown }).children;
				}
			}
			const Wrapper = () => {
				const [, refresh] = R.useReducer((n: number) => n + 1, 0);
				R.useEffect(() => {
					spec.setRefresh(refresh);
					return () => spec.setRefresh(undefined);
				}, []);
				return R.createElement(
					R.Fragment,
					null,
					...spec.registry.all().map((item: unknown, i: number) => R.createElement(ItemBoundary, { key: i }, item)),
				);
			};
			root.render(R.createElement(Wrapper));
		};

		if (place()) return start();
		const waiter = new MutationObserver(() => {
			if (place()) {
				waiter.disconnect();
				start();
			}
		});
		waiter.observe(document.body, { childList: true, subtree: true });
	});
}
