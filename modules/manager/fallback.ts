/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The capture-independent recovery surface (residual D5). The manager's normal
// page mounts through the React route overlay, which dies with any React
// capture failure — the exact disaster the manager exists to fix. This panel
// is plain DOM: no React, no stdlib primitives, no route registration. It
// mounts as a fixed card so recovery does not even depend on navigation.

import { deriveManagerState, type ManagerModuleRow } from "./state.ts";
import { managerModules, managerRuntime } from "./runtime.ts";

export interface FallbackActions {
	disable(id: string): unknown;
	enable(id: string): unknown;
	removeLocal(id: string): unknown;
	reload(): void;
}

export function buildFallbackPanel(rows: ManagerModuleRow[], actions: FallbackActions): HTMLElement {
	const panel = document.createElement("div");
	panel.id = "spicetify-manager-fallback";
	panel.className = "spicetify-manager-fallback";

	const title = document.createElement("p");
	title.className = "spicetify-manager-fallback__title";
	title.textContent = "Spicetify manager — recovery mode";
	const note = document.createElement("p");
	note.className = "spicetify-manager-fallback__note";
	note.textContent =
		"The client's React could not be captured, so module UIs (including the normal manager) cannot render. " +
		"Disable or remove a suspect module below, then reload.";
	panel.append(title, note);

	const list = document.createElement("ul");
	list.className = "spicetify-manager-fallback__list";
	for (const row of rows) {
		const item = document.createElement("li");
		const label = document.createElement("span");
		label.textContent = `${row.id}@${row.version}${row.source === "local" ? " (local)" : ""}${row.failed ? " — failed" : row.loaded ? "" : " — disabled"}`;
		item.append(label);

		const btn = (text: string, onClick: () => void) => {
			const b = document.createElement("button");
			b.textContent = text;
			b.onclick = () => {
				b.disabled = true;
				onClick();
			};
			item.append(b);
		};
		if (row.loaded || row.failed) btn("Disable", () => actions.disable(row.id));
		else btn("Enable", () => actions.enable(row.id));
		if (row.source === "local") btn("Remove local", () => actions.removeLocal(row.id));
		list.append(item);
	}
	panel.append(list);

	const reload = document.createElement("button");
	reload.className = "spicetify-manager-fallback__reload";
	reload.textContent = "Reload Spotify";
	reload.onclick = () => actions.reload();
	panel.append(reload);

	return panel;
}

// True when the live React binding is usable; the fallback mounts when not.
export function captureHealthy(react: unknown): boolean {
	return typeof (react as { createElement?: unknown })?.createElement === "function";
}

export function mountManagerFallback(): () => void {
	const g = managerRuntime();
	const M = managerModules();
	const actions: FallbackActions = {
		disable: (id) => M?.disable?.(id),
		enable: (id) => M?.enable?.(id),
		removeLocal: (id) => M?.removeLocal?.(id),
		reload: () => g.location?.reload?.(),
	};
	const panel = buildFallbackPanel(deriveManagerState().modules, actions);
	document.body.append(panel);
	return () => panel.remove();
}
