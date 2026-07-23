/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const COMMUNITY_VAULTS_URL = "https://raw.githubusercontent.com/spicetify/modules/main/community-vaults.json";
const DEFAULT_VAULT_URL = "https://raw.githubusercontent.com/spicetify/modules/main/vault.json";

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
				out.push({ id, version, artifacts: entry.artifacts, checksum: entry.checksum, vault });
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

function el(tag: string, cls?: string, text?: string) {
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
		const states = new Map(M().list().map((s: any) => [s.identifier, s]));
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
		async toggle() {
			panel.style.display = panel.style.display === "none" ? "flex" : "none";
			if (panel.style.display !== "none" && !modules.length) {
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
			}
		},
		remove: () => panel.remove(),
	};
}

export async function load() {
	const panel = createPanel();
	const btn = createTopbarButton(() => void panel.toggle());
	return () => {
		btn.remove();
		panel.remove();
	};
}
