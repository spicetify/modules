/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const COMMUNITY_VAULTS_URL = "https://raw.githubusercontent.com/spicetify/modules/main/community-vaults.json";
// Overridable for vault development: point at any URL (data: URLs work)
// to preview a vault before publishing it.
const DEFAULT_VAULT_URL = globalThis.localStorage?.getItem("spicetify:defaultVaultUrl") ??
	"https://raw.githubusercontent.com/spicetify/modules/main/vault.json";

// raw.githubusercontent and the vault hosts are CORS-enabled; github.com
// release downloads are not. Only proxy what needs it, with the raw URL
// substituted (the proxy rejects encoded targets).
const CORS_PROXY_TEMPLATE = () =>
	globalThis.localStorage?.getItem("spicetify:corsProxyTemplate") ?? "https://cors-proxy.spicetify.app/{url}";

const corsProxy = (url: string) =>
	url.startsWith("https://github.com/") ? CORS_PROXY_TEMPLATE().replace("{url}", url) : url;

const M = () => (globalThis as never as Record<string, any>).Spicetify.Modules;

type VaultModule = {
	id: string;
	version: string;
	artifacts: string[];
	checksum?: string;
	vault: string;
	meta?: {
		name?: string;
		description?: string;
		authors?: string[];
		tags?: string[];
		preview?: string;
	};
};

async function fetchJson(url: string) {
	const res = await fetch(corsProxy(url));
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	return res.json();
}

async function vaultUrls(): Promise<string[]> {
	try {
		const community = await fetchJson(COMMUNITY_VAULTS_URL);
		return [DEFAULT_VAULT_URL, ...community.map((v: { url: string }) => v.url)];
	} catch {
		return [DEFAULT_VAULT_URL];
	}
}

async function listVaultModules(): Promise<VaultModule[]> {
	const out: VaultModule[] = [];
	for (const vault of await vaultUrls()) {
		try {
			const data = await fetchJson(vault);
			for (const [id, mod] of Object.entries<any>(data.modules ?? {})) {
				const versions = Object.keys(mod.v ?? {}).sort();
				const version = mod.enabled ?? versions[versions.length - 1];
				const entry = mod.v?.[version];
				if (!entry?.artifacts?.length) continue;
				out.push({ id, version, artifacts: entry.artifacts, checksum: entry.checksum, vault, meta: entry.metadata });
			}
		} catch (e) {
			console.warn("[store] vault failed", vault, e);
		}
	}
	return out;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function installModule(mod: VaultModule, status: (msg: string) => void) {
	status(`downloading ${mod.id}@${mod.version}…`);
	const res = await fetch(corsProxy(mod.artifacts[0]));
	if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
	const zipBytes = await res.arrayBuffer();

	if (mod.checksum) {
		const got = `sha256:${await sha256Hex(zipBytes)}`;
		if (got !== mod.checksum.toLowerCase()) {
			throw new Error(`checksum mismatch: vault declares ${mod.checksum}, download is ${got}`);
		}
		status("checksum verified ✓");
	} else {
		status("no checksum in vault; installing unverified");
	}

	status("extracting…");
	const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");
	const zip = await JSZip.loadAsync(zipBytes);

	let metadata: any = null;
	const files: Record<string, string> = {};
	for (const [path, entry] of Object.entries<any>(zip.files)) {
		if (entry.dir) continue;
		const text = await entry.async("string");
		if (path === "metadata.json") metadata = JSON.parse(text);
		else files[path] = text;
	}
	if (!metadata) throw new Error("artifact has no metadata.json");
	metadata.identifier = mod.id;

	status("installing…");
	const enabled = await M().installLocal(mod.id, {
		metadata,
		files,
		sidecar: { installed_version: mod.version, classmap_base: "", allow_stale: false, checksum: mod.checksum ?? "" },
	});
	if (enabled) {
		status(`${mod.id} installed and enabled ✓`);
	} else {
		const reason = M().report?.failed?.[mod.id] ?? "unknown reason";
		status(`${mod.id} installed but failed to enable: ${reason}`);
	}
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
}

function createTopbarButton(onClick: () => void) {
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

function createPanel() {
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

	let modules: VaultModule[] = [];
	let filter = "";

	async function renderInstalled() {
		installed.replaceChildren();
		installed.appendChild(el("h3", undefined, "Installed"));
		const local = M().listLocal();
		if (!local.length) {
			installed.appendChild(el("div", "spicetify-store-empty", "Nothing installed yet"));
			return;
		}
		const states = new Map<string, any>(M().list().map((s: any) => [s.identifier, s]));
		for (const record of local) {
			const id = record.metadata.identifier;
			const row = el("div", "spicetify-store-row");
			row.appendChild(el("span", "spicetify-store-name", id));
			row.appendChild(el("span", "spicetify-store-version", record.sidecar?.installed_version ?? ""));
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
		for (const mod of modules.filter((m) => m.id.toLowerCase().includes(q))) {
			const row = el("div", "spicetify-store-row");
			row.appendChild(el("span", "spicetify-store-name", mod.id));
			row.appendChild(el("span", "spicetify-store-version", mod.version));
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

	return {
		node: panel,
		async ensureLoaded() {
			if (modules.length) return;
			status.textContent = "loading vaults…";
			try {
				modules = await listVaultModules();
				status.textContent = modules.length ? "" : "no modules found in any vault";
			} catch (e) {
				status.textContent = `failed to load vaults: ${(e as Error).message}`;
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

// Full store page on /bespoke/store, registered through stdlib's route
// register. Same standalone rule as the button: the popover panel keeps
// working without stdlib; the page is progressive enhancement.
const STORE_ROUTE = "/bespoke/store";

function createStorePage() {
	const page = el("div", "spicetify-store-page");

	const header = el("header", "spicetify-store-page-header");
	const titles = el("div");
	titles.appendChild(el("h1", undefined, "Module Store"));
	titles.appendChild(el("p", "spicetify-store-page-subtitle", "Modules from your trusted vaults"));
	const search = el("input", "spicetify-searchbar spicetify-store-page-search") as HTMLInputElement;
	search.placeholder = "Search modules…";
	header.append(titles, search);

	const status = el("div", "spicetify-store-status");
	const grid = el("div", "spicetify-store-grid");
	const installedTitle = el("h2", "spicetify-store-section-title", "Installed");
	const installedGrid = el("div", "spicetify-store-grid");
	page.append(header, status, grid, installedTitle, installedGrid);

	let modules: VaultModule[] = [];
	let filter = "";
	const setStatus = (msg: string) => (status.textContent = msg);

	function badge(text: string, ok = false) {
		return el("span", `spicetify-store-badge${ok ? " spicetify-store-badge--ok" : ""}`, text);
	}

	function renderGrid() {
		grid.replaceChildren();
		const locals = M().listLocal() as Array<{ metadata: { identifier: string }; sidecar?: { installed_version?: string } }>;
		const localIds = new Set(locals.map((r) => r.metadata.identifier));
		const localVersions = new Map(locals.map((r) => [r.metadata.identifier, r.sidecar?.installed_version]));
		const states = new Map<string, any>(M().list().map((s: any) => [s.identifier, s]));
		const q = filter.toLowerCase();
		for (const mod of modules.filter((m) => m.id.toLowerCase().includes(q))) {
			const card = el("article", "spicetify-store-card");

			if (mod.meta?.preview) {
				const img = el("img", "spicetify-store-card-preview") as HTMLImageElement;
				img.src = mod.meta.preview;
				img.loading = "lazy";
				img.alt = "";
				card.appendChild(img);
			}
			card.appendChild(el("h3", "spicetify-store-card-name", mod.meta?.name ?? mod.id));
			if (mod.meta?.description) card.appendChild(el("p", "spicetify-store-card-desc", mod.meta.description));
			if (mod.meta?.authors?.length) {
				card.appendChild(el("div", "spicetify-store-card-authors", `by ${mod.meta.authors.join(", ")}`));
			}

			const meta = el("div", "spicetify-store-card-meta");
			meta.appendChild(badge(mod.version));
			meta.appendChild(badge(mod.checksum ? "checksum ✓" : "unverified", !!mod.checksum));
			try {
				meta.appendChild(badge(new URL(mod.vault).host));
			} catch {}
			for (const tag of mod.meta?.tags ?? []) meta.appendChild(badge(tag));
			const state = states.get(mod.id) as { loaded?: boolean } | undefined;
			if (localIds.has(mod.id)) meta.appendChild(badge(state?.loaded ? "enabled" : "installed", true));
			card.appendChild(meta);

			const actions = el("div", "spicetify-store-card-actions");
			const installedVersion = localVersions.get(mod.id);
			const cta = installedVersion === undefined
				? "Install"
				: installedVersion === mod.version
				? "Reinstall"
				: "Update";
			const install = el("button", "spicetify-store-cta", cta);
			install.addEventListener("click", async () => {
				install.disabled = true;
				try {
					await installModule(mod, setStatus);
				} catch (e) {
					setStatus(`failed: ${(e as Error).message}`);
				}
				install.disabled = false;
				renderAll();
			});
			actions.appendChild(install);
			card.appendChild(actions);
			grid.appendChild(card);
		}
		if (!grid.childElementCount) {
			grid.appendChild(
				el("div", "spicetify-store-empty", modules.length ? "No modules match your search" : "No modules found in any vault"),
			);
		}
	}

	function renderInstalledGrid() {
		installedGrid.replaceChildren();
		const local = M().listLocal();
		installedTitle.style.display = local.length ? "" : "none";
		const states = new Map<string, any>(M().list().map((s: any) => [s.identifier, s]));
		for (const record of local) {
			const id = record.metadata.identifier;
			const state = states.get(id) as { loaded?: boolean } | undefined;
			const card = el("article", "spicetify-store-card");

			card.appendChild(el("h3", "spicetify-store-card-name", id));

			const meta = el("div", "spicetify-store-card-meta");
			const version = record.sidecar?.installed_version ?? "";
			if (version) meta.appendChild(badge(version));
			meta.appendChild(badge(state?.loaded ? "enabled" : "disabled", !!state?.loaded));
			card.appendChild(meta);

			const actions = el("div", "spicetify-store-card-actions");
			const toggle = el("button", "spicetify-store-cta", state?.loaded ? "Disable" : "Enable");
			toggle.addEventListener("click", async () => {
				try {
					if (state?.loaded) await M().disable(id);
					else await M().enable(id);
				} catch (e) {
					setStatus(`failed: ${(e as Error).message}`);
				}
				renderAll();
			});
			const remove = el("button", "spicetify-store-danger", "Remove");
			remove.addEventListener("click", async () => {
				try {
					await M().removeLocal(id);
				} catch (e) {
					setStatus(`failed: ${(e as Error).message}`);
				}
				renderAll();
			});
			actions.append(toggle, remove);
			card.appendChild(actions);
			installedGrid.appendChild(card);
		}
	}

	function renderAll() {
		renderGrid();
		renderInstalledGrid();
	}

	search.addEventListener("input", () => {
		filter = search.value;
		renderGrid();
	});

	let loaded = false;
	return {
		node: page,
		async ensureLoaded() {
			if (loaded) return;
			loaded = true;
			setStatus("loading vaults…");
			try {
				modules = await listVaultModules();
				setStatus(modules.length ? "" : "no modules found in any vault");
			} catch (e) {
				setStatus(`failed to load vaults: ${(e as Error).message}`);
			}
			renderAll();
		},
	};
}

async function registerStorePage(
	page: ReturnType<typeof createStorePage>,
): Promise<(() => void) | null> {
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

// Marketplace-style circular icon button in the global nav, registered
// through stdlib when it is installed. The store stays standalone by
// design, so a fixed-position fallback button covers a missing or broken
// stdlib.

export async function load() {
	const page = createStorePage();
	const disposePage = await registerStorePage(page);
	// With stdlib present the store is a navlink + full page, following the
	// Home/marketplace pattern with an active state. The fixed button and
	// panel remain the standalone fallback so the store can always rescue a
	// broken setup.
	const disposeNavlink = await createStdlibNavlink();

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

	return () => {
		disposePage?.();
		page.node.remove();
		disposeNavlink?.();
		fallbackBtn?.remove();
		panel?.remove();
	};
}
