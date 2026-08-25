/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Platform } from "../expose/Platform.ts";
import { React } from "../expose/React.ts";
import { mountRegistryAnchor } from "./mount.ts";
import { Registry } from "./registry.ts";

const registry = new (class extends Registry<React.ReactNode> {
	override add(value: React.ReactNode): this {
		refresh?.();
		return super.add(value);
	}

	override delete(value: React.ReactNode): boolean {
		refresh?.();
		return super.delete(value);
	}
})();
export default registry;

let refresh: (() => void) | undefined;
let historyHooked = false;

// The client router never learns module routes, so a
// history-driven overlay covers the main view whenever the current path
// matches a registered <Route>. The client renders its own not-found page
// underneath; back/forward keep working because only real history is used.
const matchRoute = (pathname: string, pattern: string): boolean => {
	const path = pathname.split("/").filter(Boolean);
	const parts = pattern.split("/").filter(Boolean);
	for (let i = 0; i < parts.length; i++) {
		if (parts[i] === "*") return true;
		if (parts[i].startsWith(":")) {
			if (path[i] === undefined) return false;
			continue;
		}
		if (parts[i] !== path[i]) return false;
	}
	return path.length === parts.length;
};

mountRegistryAnchor({
	className: "spicetify-route-overlay",
	registry,
	setRefresh: (cb) => {
		refresh = cb;
		if (cb && !historyHooked) {
			historyHooked = true;
			try {
				Platform.getHistory().listen(() => refresh?.());
			} catch (e) {
				console.warn("[stdlib] route overlay cannot follow history:", e);
			}
		}
	},
	findSlot: () => {
		const main = document.querySelector(".main-view-container");
		return main ? { parent: main } : null;
	},
	renderItems: (items) => {
		const pathname = (() => {
			try {
				return Platform.getHistory().location.pathname as string;
			} catch {
				return null;
			}
		})();
		if (!pathname) return null;
		// Items are react-router <Route path element> elements; a Route
		// cannot render outside the client's <Routes>, so the overlay
		// renders the element's content directly.
		const route = items.find((item: any) => {
			const path = item?.props?.path;
			return typeof path === "string" && matchRoute(pathname, path);
		}) as { props: { path: string; element?: unknown; children?: unknown } } | undefined;
		if (!route) return null;
		return (React as any).createElement(
			"div",
			{
				key: route.props.path,
				className: "spicetify-route-page",
				style: {
					position: "absolute",
					inset: 0,
					// Just high enough to cover the client's own view (its
					// positioned children top out at 2) and no higher: this page
					// is opaque, so anything above it in the stack disappears.
					// Theme chrome drawn over the view — panel borders, labels —
					// sits above that and must keep showing.
					zIndex: 2,
					overflow: "auto",
					// The opaque background lives in index.scss so a theme can
					// restyle it without fighting an inline declaration.
				},
			},
			(route.props.element ?? route.props.children) as never,
		);
	},
});
