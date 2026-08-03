/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { loadKit } from "./kit.ts";
import { createStorePage, STORE_ROUTE } from "./page.ts";
import { createPanel, createTopbarButton } from "./panel.ts";
import { markDisposed, openDialogClosers, retryTimers, setOnCountsChanged } from "./runtime.ts";
import { announceUpdates } from "./updates.ts";

async function registerStorePage(page: ReturnType<typeof createStorePage>): Promise<(() => void) | null> {
	try {
		const [{ Registrar }, { React }] = await Promise.all([
			import("/modules/stdlib/src/registers/index.js"),
			import("/modules/stdlib/src/expose/React.js"),
		]);
		const registrar = new Registrar("store-page");
		// Hook-free host: the route overlay renders it with the client
		// React; the vanilla page node mounts through the ref.
		const Host = () =>
			React.createElement("div", {
				className: "spicetify-store-page-host",
				ref: (node: HTMLElement | null) => {
					if (node && !node.contains(page.node)) {
						node.appendChild(page.node);
						void page.ensureLoaded();
					}
				},
			});
		registrar.registerRoute(STORE_ROUTE, React.createElement(Host));
		return () => registrar.dispose();
	} catch (e) {
		console.warn("[store] page route unavailable:", e);
		return null;
	}
}

// Marketplace-style circular icon button in the global nav, registered
// through stdlib when it is installed. The store stays standalone by
// design, so a fixed-position fallback button covers a missing or broken
// stdlib.
// Filled bag for the active route, outlined bag otherwise -- the same
// active/inactive glyph pattern Home uses.
const STORE_ICON_FILLED =
	'<path d="M5 4a3 3 0 1 1 6 0h2.5A1.5 1.5 0 0 1 15 5.5l-.9 8A2 2 0 0 1 12.11 15H3.89a2 2 0 0 1-1.99-1.5l-.9-8A1.5 1.5 0 0 1 2.5 4H5zm1.5 0h3a1.5 1.5 0 1 0-3 0z"/>';
const STORE_ICON_OUTLINE =
	'<path fill-rule="evenodd" d="M5 4a3 3 0 1 1 6 0h2.5A1.5 1.5 0 0 1 15 5.5l-.9 8A2 2 0 0 1 12.11 15H3.89a2 2 0 0 1-1.99-1.5l-.9-8A1.5 1.5 0 0 1 2.5 4H5zm1.5 0h3a1.5 1.5 0 1 0-3 0zM2.75 5.25l.84 7.5a.75.75 0 0 0 .75.65h7.32a.75.75 0 0 0 .75-.65l.84-7.5H2.75z"/>';

async function createStdlibNavlink(): Promise<(() => void) | null> {
	try {
		const [{ Registrar }, { NavLink }, { React }] = await Promise.all([
			import("/modules/stdlib/src/registers/index.js"),
			import("/modules/stdlib/src/registers/navlink.js"),
			import("/modules/stdlib/src/expose/React.js"),
		]);
		const registrar = new Registrar("store");
		registrar.register(
			"navlink",
			React.createElement(NavLink, {
				localizedApp: "Module Store",
				appRoutePath: STORE_ROUTE,
				icon: STORE_ICON_OUTLINE,
				activeIcon: STORE_ICON_FILLED,
			}),
		);
		return () => registrar.dispose();
	} catch (e) {
		console.warn("[store] stdlib navlink unavailable, using fallback:", e);
		return null;
	}
}

export async function load() {
	// Enhanced path: the kit and the full page require stdlib. If stdlib is
	// absent (or its route register is broken), this throws and we drop to
	// the vanilla fallback below — the store's standalone-survival design.
	let page: ReturnType<typeof createStorePage> | null = null;
	let disposePage: (() => void) | null = null;
	let disposeNavlink: (() => void) | null = null;
	try {
		await loadKit();
		page = createStorePage();
		disposePage = await registerStorePage(page);
		disposeNavlink = await createStdlibNavlink();
	} catch (e) {
		console.warn("[store] enhanced path unavailable, using fallback:", e);
	}

	// The fixed button and popover panel are the standalone fallback (plain
	// DOM, no kit) so the store can always rescue a broken setup.
	let fallbackBtn: HTMLElement | null = null;
	let panel: ReturnType<typeof createPanel> | null = null;
	if (!disposeNavlink) {
		panel = createPanel();
		const p = panel;
		fallbackBtn = createTopbarButton(() => {
			p.node.style.display = p.node.style.display === "none" ? "flex" : "none";
			if (p.node.style.display !== "none") void p.ensureLoaded();
		});
	}

	// Fire-and-forget: the loader must never wait on a vault fetch.
	void announceUpdates();

	return () => {
		markDisposed();
		for (const timer of retryTimers) clearTimeout(timer);
		retryTimers.clear();
		for (const close of openDialogClosers) close();
		openDialogClosers.clear();
		setOnCountsChanged(null);
		disposePage?.();
		page?.node.remove();
		disposeNavlink?.();
		fallbackBtn?.remove();
		panel?.remove();
	};
}
