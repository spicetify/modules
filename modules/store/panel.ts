/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type Catalog, displayVersion, loadCatalog, searchHaystack } from "./catalog.ts";
import { installModule } from "./install.ts";
import { el, M } from "./runtime.ts";

// ---------- fallback popover panel (standalone survival) ----------

export function createTopbarButton(onClick: () => void) {
	// Append to body (never inside React-managed containers) and position over
	// the topbar; React reconciliation must not find or touch this node.
	const host = el("div", "spicetify-store-anchor");
	const btn = el("button", `${MAP.main.topbar.right.button.wrapper} spicetify-store-btn`, "Store");
	btn.setAttribute("aria-label", "Open module store");
	btn.addEventListener("click", onClick);
	host.appendChild(btn);
	document.body.appendChild(host);
	return host;
}

export function createPanel() {
	const panel = el("div", "spicetify-store-panel");
	panel.style.display = "none";

	const header = el("div", "spicetify-store-header");
	header.appendChild(el("h2", undefined, "Module store"));
	const close = el("button", "spicetify-store-close", "×");
	close.addEventListener("click", () => (panel.style.display = "none"));
	header.appendChild(close);

	const status = el("div", "spicetify-store-status", "");
	const search = el("input", "spicetify-store-search");
	search.placeholder = "Search modules…";
	const list = el("div", "spicetify-store-list");
	const installed = el("div", "spicetify-store-installed");

	panel.append(header, search, status, list, installed);
	document.body.appendChild(panel);

	let catalog: Catalog = { modules: [], revoked: {}, ok: false };
	let filter = "";

	async function renderInstalled() {
		installed.replaceChildren();
		installed.appendChild(el("h3", undefined, "Installed"));
		const local = M().listLocal();
		if (!local.length) {
			installed.appendChild(el("div", "spicetify-store-empty", "Nothing installed yet"));
			return;
		}
		const states = new Map<string, any>(
			M()
				.list()
				.map((s: any) => [s.identifier, s]),
		);
		for (const record of local) {
			const id = record.metadata.identifier;
			const row = el("div", "spicetify-store-row");
			row.appendChild(el("span", "spicetify-store-name", id));
			row.appendChild(
				el("span", "spicetify-store-version", displayVersion(record.sidecar?.installed_version ?? "")),
			);
			const state = states.get(id);
			const toggle = el("button", undefined, state?.loaded ? "Disable" : "Enable");
			toggle.addEventListener("click", async () => {
				try {
					if (states.get(id)?.loaded) await M().disable(id);
					else await M().enable(id);
				} catch (e) {
					status.textContent = `failed: ${(e as Error).message}`;
				}
				await renderInstalled();
			});
			const remove = el("button", "spicetify-store-danger", "Remove");
			remove.addEventListener("click", async () => {
				try {
					await M().removeLocal(id);
				} catch (e) {
					status.textContent = `failed: ${(e as Error).message}`;
				}
				await renderInstalled();
			});
			row.append(toggle, remove);
			installed.appendChild(row);
		}
	}

	async function renderList() {
		list.replaceChildren();
		const q = filter.toLowerCase();
		for (const mod of catalog.modules.filter((m) => !catalog.revoked[m.id] && searchHaystack(m).includes(q))) {
			const row = el("div", "spicetify-store-row");
			row.appendChild(el("span", "spicetify-store-name", mod.id));
			row.appendChild(el("span", "spicetify-store-version", displayVersion(mod.version)));
			const btn = el("button", undefined, "Install");
			btn.addEventListener("click", async () => {
				btn.disabled = true;
				btn.textContent = "…";
				try {
					await installModule(mod, (msg) => (status.textContent = msg));
					await renderInstalled();
				} catch (e) {
					status.textContent = `failed: ${(e as Error).message}`;
				} finally {
					btn.disabled = false;
					btn.textContent = "Install";
				}
			});
			row.appendChild(btn);
			list.appendChild(row);
		}
	}

	search.addEventListener("input", () => {
		filter = search.value;
		void renderList();
	});

	let loading = false;
	return {
		node: panel,
		async ensureLoaded() {
			// Retry until at least one vault has actually answered.
			if (catalog.ok || loading) return;
			loading = true;
			status.textContent = "loading vaults…";
			try {
				catalog = await loadCatalog();
				status.textContent = catalog.ok
					? catalog.modules.length
						? ""
						: "no modules found in any vault"
					: "vaults unreachable, will retry";
			} finally {
				loading = false;
			}
			await renderList();
			try {
				await renderInstalled();
			} catch (e) {
				status.textContent = `failed to load installs: ${(e as Error).message}`;
			}
		},
		remove: () => panel.remove(),
	};
}
