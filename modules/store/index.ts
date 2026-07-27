/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Badge, Button, Chip, openDialog, Select, Textarea, TextInput } from "/modules/stdlib/lib/ui.js";

const COMMUNITY_VAULTS_URL = "https://raw.githubusercontent.com/spicetify/modules/main/community-vaults.json";
// Overridable for vault development: point at any URL (data: URLs work)
// to preview a vault before publishing it. Read lazily like the other
// overrides so a change applies on the next load, not the next boot.
const DEFAULT_VAULT_URL = () =>
	globalThis.localStorage?.getItem("spicetify:defaultVaultUrl") ??
		"https://raw.githubusercontent.com/spicetify/modules/main/vault.json";

// raw.githubusercontent and the vault hosts are CORS-enabled; github.com
// release downloads are not. Only proxy what needs it, with the raw URL
// substituted (the proxy rejects encoded targets).
const CORS_PROXY_TEMPLATE = () =>
	globalThis.localStorage?.getItem("spicetify:corsProxyTemplate") ?? "https://cors-proxy.spicetify.app/{url}";

const corsProxy = (url: string) =>
	url.startsWith("https://github.com/") ? CORS_PROXY_TEMPLATE().replace("{url}", url) : url;

// Unique-install counts; absent/unreachable degrades to no badges and
// name-ordered sorting, never to an error.
const INSTALLS_API = () =>
	globalThis.localStorage?.getItem("spicetify:installsApiUrl") ?? "https://installs.spicetify.app";

const M = () => (globalThis as never as Record<string, any>).Spicetify.Modules;
const PLATFORM = () => (globalThis as never as Record<string, any>).Spicetify?.Platform;

// Infrastructure modules: stdlib is the foundation every module depends
// on, and store/manager are the management surfaces themselves. Disabling
// or removing any of them from inside the client destroys the very UI
// doing it, so the store never offers those actions for them.
const PROTECTED = new Set(["stdlib", "store", "manager"]);

type VaultModule = {
	id: string;
	version: string;
	artifacts: string[];
	// Inline content: small modules (css snippets) ship their files inside
	// the vault entry and install without any artifact download.
	files?: Record<string, string>;
	checksum?: string;
	vault: string;
	updatedAt?: string;
	meta?: {
		name?: string;
		description?: string;
		authors?: string[];
		tags?: string[];
		preview?: string;
		repository?: string;
		readme?: string;
	};
};

// ok: at least one vault answered; an all-failed load must not latch an
// empty catalog.
type Catalog = { modules: VaultModule[]; revoked: Record<string, string>; ok: boolean };

// Numeric semver-ish compare; plain string sort breaks at x.10.0.
function compareVersions(a: string, b: string): number {
	const parse = (v: string) => v.split(/[+-]/)[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
	const [pa, pb] = [parse(a), parse(b)];
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return a.localeCompare(b);
}

async function fetchJson(url: string) {
	const res = await fetch(corsProxy(url));
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	return res.json();
}

async function vaultUrls(): Promise<string[]> {
	const urls = [DEFAULT_VAULT_URL()];
	try {
		const community = await fetchJson(COMMUNITY_VAULTS_URL);
		for (const v of community as Array<{ url: string }>) {
			if (v.url && !urls.includes(v.url)) urls.push(v.url);
		}
	} catch {}
	return urls;
}

// github.com artifact URLs imply the source repository; explicit
// metadata.repository wins when present.
function deriveRepository(mod: VaultModule): string | null {
	const explicit = mod.meta?.repository;
	if (explicit?.startsWith("https://")) return explicit;
	const artifact = mod.artifacts[0];
	const gh = artifact?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\//);
	return gh ? `https://github.com/${gh[1]}` : null;
}

async function loadCatalog(): Promise<Catalog> {
	const out: VaultModule[] = [];
	const seen = new Set<string>();
	const revoked: Record<string, string> = {};
	let ok = false;
	const urls = await vaultUrls();
	for (const vault of urls) {
		try {
			const data = await fetchJson(vault);
			ok = true;
			// Only the default (curated) vault may revoke globally; a
			// community vault must not be able to disable other vaults'
			// modules.
			if (vault === urls[0]) {
				for (const [id, reason] of Object.entries<string>(data.revoked ?? {})) {
					revoked[id] ??= reason;
				}
			}
			for (const [id, mod] of Object.entries<any>(data.modules ?? {})) {
				// First vault wins; the default vault is fetched first.
				if (seen.has(id)) continue;
				const versions = Object.keys(mod.v ?? {}).sort(compareVersions);
				const version = mod.enabled ?? versions[versions.length - 1];
				const entry = mod.v?.[version];
				if (!entry) continue;
				if (!entry.artifacts?.length && !entry.files) continue;
				seen.add(id);
				out.push({
					id,
					version,
					artifacts: entry.artifacts ?? [],
					files: entry.files,
					checksum: entry.checksum,
					vault,
					updatedAt: entry.updatedAt,
					meta: entry.metadata,
				});
			}
		} catch (e) {
			console.warn("[store] vault failed", vault, e);
		}
	}
	return { modules: out, revoked, ok };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- install counting (ranking signal) ----------

const installCounts: Record<string, number> = {};
// The page subscribes so a freshly counted install refreshes its badge.
let onCountsChanged: (() => void) | null = null;
// Module lifecycle: dispose() must cancel retry timers and close
// overlays; nothing may outlive the module.
let disposed = false;
const retryTimers = new Set<ReturnType<typeof setTimeout>>();
const openDialogClosers = new Set<() => void>();

async function fetchInstallCounts(ids: string[]): Promise<void> {
	const base = INSTALLS_API();
	for (let i = 0; i < ids.length; i += 100) {
		const chunk = ids.slice(i, i + 100);
		try {
			const res = await fetch(`${base}/v1/installs?modules=${encodeURIComponent(chunk.join(","))}`);
			if (!res.ok) return;
			const data = await res.json() as { counts?: Record<string, number> };
			Object.assign(installCounts, data.counts ?? {});
		} catch {
			return;
		}
	}
}

// Fire-and-forget: an install must never fail or slow down because the
// counter is down. The server verifies the token against Spotify and
// stores only a keyed hash of the account id, so repeat installs by the
// same account are not double counted.
function reportInstall(mod: VaultModule, attempt = 0): void {
	if (disposed) return;
	try {
		const session = PLATFORM()?.Session;
		const token = session?.accessToken;
		if (!token || session?.isAnonymous) return;
		void fetch(`${INSTALLS_API()}/v1/installs`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({ module: mod.id, version: mod.version.split("+")[0] }),
		}).then(async (res) => {
			// Spotify throttles the server's identity check at times; one
			// deferred retry recovers most of those counts.
			if (res.status === 503 && attempt === 0) {
				const wait = Number(res.headers.get("retry-after") ?? 60);
				const timer = setTimeout(() => {
					retryTimers.delete(timer);
					if (!disposed) reportInstall(mod, 1);
				}, Math.min(wait, 120) * 1000);
				retryTimers.add(timer);
				return;
			}
			if (!res.ok) return;
			const data = await res.json() as { counted?: boolean };
			if (data.counted) {
				installCounts[mod.id] = (installCounts[mod.id] ?? 0) + 1;
				onCountsChanged?.();
			}
		}).catch(() => {});
	} catch {}
}

// ---------- install / lifecycle ----------

function localRecords(): Array<{ metadata: any; sidecar?: any; files?: Record<string, string> }> {
	return M().listLocal();
}

function tagsOfLocal(id: string): string[] {
	const record = localRecords().find((r) => r.metadata.identifier === id);
	return record?.metadata?.tags ?? [];
}

// Themes fight over the same client chrome; enabling one disables the
// others, marketplace-style.
async function enforceSingleTheme(id: string, status: (msg: string) => void): Promise<void> {
	if (!tagsOfLocal(id).includes("theme")) return;
	for (const state of M().list() as Array<{ identifier: string; loaded: boolean }>) {
		if (state.identifier === id || !state.loaded) continue;
		if (tagsOfLocal(state.identifier).includes("theme")) {
			await M().disable(state.identifier);
			status(`disabled ${state.identifier} (one theme at a time)`);
		}
	}
}

const installing = new Set<string>();

async function installModule(mod: VaultModule, status: (msg: string) => void) {
	if (installing.has(mod.id)) {
		status(`${mod.id} is already installing`);
		return;
	}
	installing.add(mod.id);
	try {
		await installModuleInner(mod, status);
	} finally {
		installing.delete(mod.id);
	}
}

async function installModuleInner(mod: VaultModule, status: (msg: string) => void) {
	let metadata: any = null;
	let files: Record<string, string>;

	if (mod.files) {
		// Inline content: the vault entry is the artifact. Inline entries
		// are stylesheet-only; executable content must ship as a
		// checksummed artifact.
		files = {};
		for (const [name, content] of Object.entries(mod.files)) {
			if (name.endsWith(".css")) files[name] = content;
		}
		if (!Object.keys(files).length) throw new Error("inline entry has no css files");
	} else {
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

		files = {};
		for (const [path, entry] of Object.entries<any>(zip.files)) {
			if (entry.dir) continue;
			const text = await entry.async("string");
			if (path === "metadata.json") metadata = JSON.parse(text);
			else files[path] = text;
		}
		if (!metadata) throw new Error("artifact has no metadata.json");
	}

	metadata ??= {
		name: mod.meta?.name ?? mod.id,
		tags: mod.meta?.tags ?? [],
		version: mod.version,
		authors: mod.meta?.authors ?? [],
		description: mod.meta?.description ?? "",
		entries: {
			...(files["index.js"] ? { js: "index.js" } : {}),
			...(files["index.css"] ? { css: "index.css" } : {}),
		},
		hasMixins: false,
		dependencies: {},
	};
	metadata.identifier = mod.id;

	status("installing…");
	// Re-installs must not stack a second live instance on the old one.
	try {
		await M().disable(mod.id);
	} catch {}
	const enabled = await M().installLocal(mod.id, {
		metadata,
		files,
		sidecar: { installed_version: mod.version, classmap_base: "", allow_stale: false, checksum: mod.checksum ?? "" },
	});
	if (enabled) {
		status(`${mod.id} installed and enabled ✓`);
		await enforceSingleTheme(mod.id, status);
		reportInstall(mod);
	} else {
		const reason = M().report?.failed?.[mod.id] ?? "unknown reason";
		status(`${mod.id} installed but failed to enable: ${reason}`);
	}
}

// ---------- shared dom helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
}

function searchHaystack(mod: VaultModule): string {
	return [
		mod.id,
		mod.meta?.name ?? "",
		mod.meta?.description ?? "",
		...(mod.meta?.authors ?? []),
		...(mod.meta?.tags ?? []),
	].join(" ").toLowerCase();
}

const displayName = (mod: VaultModule) => mod.meta?.name ?? mod.id;

// ---------- tiny safe markdown (readme rendering) ----------
// Built with createElement/textContent only; raw HTML in the source is
// rendered as text, never interpreted.

function renderInline(target: HTMLElement, text: string): void {
	const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\((https:\/\/[^)\s]+)\))/g;
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		target.append(text.slice(last, match.index));
		if (match[1]) target.appendChild(el("code", undefined, match[1].slice(1, -1)));
		else if (match[2]) target.appendChild(el("strong", undefined, match[2].slice(2, -2)));
		else if (match[3]) {
			const a = el("a", undefined, match[4]);
			a.href = match[5];
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			target.appendChild(a);
		}
		last = match.index + match[0].length;
	}
	target.append(text.slice(last));
}

function renderMarkdown(md: string): HTMLElement {
	const root = el("div", "spicetify-store-markdown");
	const lines = md.split(/\r?\n/);
	let list: HTMLUListElement | null = null;
	let fence: HTMLElement | null = null;
	for (const line of lines) {
		if (fence) {
			if (/^```/.test(line)) fence = null;
			else fence.textContent += `${line}\n`;
			continue;
		}
		if (/^```/.test(line)) {
			const pre = el("pre");
			fence = el("code");
			pre.appendChild(fence);
			root.appendChild(pre);
			continue;
		}
		const item = line.match(/^\s*[-*]\s+(.*)$/);
		if (item) {
			if (!list) {
				list = el("ul");
				root.appendChild(list);
			}
			const li = el("li");
			renderInline(li, item[1]);
			list.appendChild(li);
			continue;
		}
		list = null;
		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			const level = Math.min(heading[1].length + 2, 6);
			const h = el(`h${level}` as "h3");
			renderInline(h, heading[2]);
			root.appendChild(h);
			continue;
		}
		if (line.trim()) {
			const p = el("p");
			renderInline(p, line);
			root.appendChild(p);
		}
	}
	return root;
}

// ---------- modal overlay (details, snippet editor) ----------

function openOverlay(title: string): { body: HTMLElement; close: () => void } {
	// The kit owns the scrim/dialog/close chrome; the store tracks the
	// closer so a module unload tears down any open dialog.
	const handle = openDialog({ title, children: [] });
	openDialogClosers.add(handle.close);
	const close = () => {
		openDialogClosers.delete(handle.close);
		handle.close();
	};
	return { body: handle.body, close };
}

// ---------- snippet authoring ----------

const slugify = (name: string) =>
	name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "snippet";

function openSnippetEditor(
	existing: { id: string; name: string; css: string } | null,
	onSaved: () => void,
	status: (msg: string) => void,
): void {
	const { body, close } = openOverlay(existing ? `Edit ${existing.name}` : "New CSS snippet");

	const nameInput = TextInput({ placeholder: "Snippet name", value: existing?.name ?? "", disabled: !!existing });

	const css = Textarea({ placeholder: "/* your css */", value: existing?.css ?? "" });
	css.className = "spicetify-store-snippet-css";
	css.spellcheck = false;

	const actions = el("div", "spicetify-store-card-actions");
	const save = Button({ label: existing ? "Save" : "Create", onClick: async () => {
		const name = nameInput.value.trim();
		if (!name || !css.value.trim()) return;
		const id = existing?.id ?? `snippet-user-${slugify(name)}`;
		// Creating over an existing snippet needs an explicit second click.
		if (!existing && localRecords().some((r) => r.metadata.identifier === id) && save.dataset.confirm !== "1") {
			save.dataset.confirm = "1";
			save.textContent = "Overwrite existing?";
			return;
		}
		save.disabled = true;
		try {
			try {
				await M().disable(id);
			} catch {}
			await M().installLocal(id, {
				metadata: {
					identifier: id,
					name,
					tags: ["snippet", "custom"],
					version: "0.0.0",
					authors: [PLATFORM()?.username ?? "you"],
					description: "Custom CSS snippet",
					entries: { css: "index.css" },
					hasMixins: false,
					dependencies: {},
				},
				files: { "index.css": css.value },
				sidecar: { installed_version: "0.0.0", classmap_base: "", allow_stale: false, checksum: "" },
			});
			status(`${name} applied ✓`);
			close();
			onSaved();
		} catch (e) {
			status(`snippet failed: ${(e as Error).message}`);
			save.disabled = false;
		}
	} });
	actions.appendChild(save);
	body.append(nameInput, css, actions);
	nameInput.focus();
}

// ---------- module detail view ----------

function openModuleDetails(
	mod: VaultModule,
	installLabel: string,
	onInstall: (btn: HTMLButtonElement) => void,
): void {
	const { body } = openOverlay(displayName(mod));

	if (mod.meta?.preview) {
		const img = el("img", "spicetify-store-detail-preview") as HTMLImageElement;
		img.src = mod.meta.preview;
		img.alt = "";
		body.appendChild(img);
	}

	const meta = el("div", "spicetify-store-card-meta");
	meta.appendChild(Badge({ text: mod.version }));
	const count = installCounts[mod.id];
	if (count !== undefined) meta.appendChild(Badge({ text: `${count} installs` }));
	meta.appendChild(
		Badge({
			text: mod.files ? "inline ✓" : mod.checksum ? "checksum ✓" : "unverified",
			tone: mod.checksum || mod.files ? "ok" : "neutral",
		}),
	);
	for (const tag of mod.meta?.tags ?? []) meta.appendChild(Badge({ text: tag }));
	body.appendChild(meta);

	if (mod.meta?.authors?.length) {
		body.appendChild(el("div", "spicetify-store-card-authors", `by ${mod.meta.authors.join(", ")}`));
	}
	if (mod.meta?.description) body.appendChild(el("p", undefined, mod.meta.description));

	const repo = deriveRepository(mod);
	if (repo) {
		const link = el("a", "spicetify-store-repo-link", repo.replace("https://", ""));
		link.href = repo;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		body.appendChild(link);
	}

	const actions = el("div", "spicetify-store-card-actions");
	const install = Button({ label: installLabel, onClick: () => onInstall(install) });
	actions.appendChild(install);
	body.appendChild(actions);

	const readme = mod.meta?.readme;
	if (readme?.startsWith("https://")) {
		const holder = el("div", "spicetify-store-empty", "loading readme…");
		body.appendChild(holder);
		void fetch(corsProxy(readme))
			.then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
			.then((text) => holder.replaceWith(renderMarkdown(text)))
			.catch(() => holder.remove());
	}
}

// ---------- store data (backup / restore / reset) ----------

const OWNED_PREFIXES = ["spicetify.modules.local.", "spicetify:scheme:"];
// Endpoint overrides are deliberately excluded from backups: importing a
// crafted file must never be able to repoint the vault, the CORS proxy,
// or the installs API (which receives the session token). Setting those
// stays a manual, deliberate act.
const ENDPOINT_KEYS = [
	"spicetify:defaultVaultUrl",
	"spicetify:corsProxyTemplate",
	"spicetify:installsApiUrl",
];
const PREF_KEYS = [
	"spicetify:store:sort",
	"spicetify:store:tab",
];

const isBackupKey = (key: string) => PREF_KEYS.includes(key) || OWNED_PREFIXES.some((p) => key.startsWith(p));
const isOwnedKey = (key: string) => isBackupKey(key) || ENDPOINT_KEYS.includes(key);

function exportStoreData(): string {
	const keys: Record<string, string> = {};
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i)!;
		if (isBackupKey(key)) keys[key] = localStorage.getItem(key)!;
	}
	return JSON.stringify({ format: "spicetify-store-backup", version: 1, keys }, null, "\t");
}

function importStoreData(text: string): number {
	const data = JSON.parse(text) as { format?: string; keys?: Record<string, unknown> };
	if (data.format !== "spicetify-store-backup" || !data.keys) throw new Error("not a store backup");
	let written = 0;
	for (const [key, value] of Object.entries(data.keys)) {
		if (!isBackupKey(key) || typeof value !== "string") continue;
		localStorage.setItem(key, value);
		written++;
	}
	return written;
}

function resetStoreData(): number {
	const doomed: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i)!;
		if (isOwnedKey(key)) doomed.push(key);
	}
	for (const key of doomed) localStorage.removeItem(key);
	return doomed.length;
}

// ---------- fallback popover panel (standalone survival) ----------

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
		for (const mod of catalog.modules.filter((m) => !catalog.revoked[m.id] && searchHaystack(m).includes(q))) {
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
					? (catalog.modules.length ? "" : "no modules found in any vault")
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

// ---------- full store page ----------

// Full store page on /bespoke/store, registered through stdlib's route
// register. Same standalone rule as the button: the popover panel keeps
// working without stdlib; the page is progressive enhancement.
const STORE_ROUTE = "/bespoke/store";

const TABS: Array<{ key: string; label: string; tag?: string }> = [
	{ key: "all", label: "All" },
	{ key: "extension", label: "Extensions", tag: "extension" },
	{ key: "theme", label: "Themes", tag: "theme" },
	{ key: "snippet", label: "Snippets", tag: "snippet" },
	{ key: "app", label: "Apps", tag: "app" },
];

const SORTS: Array<{ key: string; label: string }> = [
	{ key: "installs", label: "Most installed" },
	{ key: "az", label: "Name A-Z" },
	{ key: "za", label: "Name Z-A" },
	{ key: "updated", label: "Recently updated" },
];

function createStorePage() {
	const page = el("div", "spicetify-store-page");

	const header = el("header", "spicetify-store-page-header");
	const titles = el("div");
	titles.appendChild(el("h1", undefined, "Module Store"));
	titles.appendChild(el("p", "spicetify-store-page-subtitle", "Modules from your trusted vaults"));
	const search = TextInput({ placeholder: "Search modules…" });
	search.classList.add("spicetify-store-page-search");
	header.append(titles, search);

	const toolbar = el("div", "spicetify-store-toolbar");
	const chips = el("div", "spicetify-store-chips");
	const sortSelect = Select({
		options: SORTS.map((sort) => ({ value: sort.key, label: sort.label })),
		value: "installs",
		onChange: (value) => {
			activeSort = value;
			try {
				localStorage.setItem("spicetify:store:sort", activeSort);
			} catch {}
			renderGrid();
		},
	});
	const newSnippet = el("button", "spicetify-store-cta", "New snippet");
	toolbar.append(chips, sortSelect, newSnippet);

	const updates = el("div", "spicetify-store-updates");
	updates.style.display = "none";

	const status = el("div", "spicetify-store-status");
	const grid = el("div", "spicetify-store-grid");
	const installedTitle = el("h2", "spicetify-store-section-title", "Installed");
	const installedGrid = el("div", "spicetify-store-grid");

	const dataRow = el("div", "spicetify-store-data-row");
	dataRow.appendChild(el("span", "spicetify-store-data-label", "Store data:"));
	const exportBtn = el("button", undefined, "Export");
	const importBtn = el("button", undefined, "Import");
	const importInput = el("input") as HTMLInputElement;
	importInput.type = "file";
	importInput.accept = "application/json";
	importInput.style.display = "none";
	const resetBtn = el("button", "spicetify-store-danger", "Reset");
	dataRow.append(exportBtn, importBtn, importInput, resetBtn);

	page.append(header, toolbar, updates, status, grid, installedTitle, installedGrid, dataRow);

	let catalog: Catalog = { modules: [], revoked: {}, ok: false };
	let filter = "";
	let activeTab = globalThis.localStorage?.getItem("spicetify:store:tab") ?? "all";
	let activeSort = globalThis.localStorage?.getItem("spicetify:store:sort") ?? "installs";
	if (!SORTS.some((s) => s.key === activeSort)) activeSort = "installs";
	sortSelect.value = activeSort;
	const autoDisabledRevoked = new Set<string>();
	const setStatus = (msg: string) => (status.textContent = msg);

	const badge = (text: string, ok = false) => Badge({ text, tone: ok ? "ok" : "neutral" });

	function renderChips() {
		chips.replaceChildren();
		for (const tab of TABS) {
			chips.appendChild(Chip({
				label: tab.label,
				active: tab.key === activeTab,
				onClick: () => {
					activeTab = tab.key;
					try {
						localStorage.setItem("spicetify:store:tab", activeTab);
					} catch {}
					renderChips();
					renderGrid();
				},
			}));
		}
	}

	function visibleModules(): VaultModule[] {
		const q = filter.toLowerCase();
		const tab = TABS.find((t) => t.key === activeTab);
		const list = catalog.modules.filter((mod) => {
			if (catalog.revoked[mod.id]) return false;
			if (tab?.tag && !(mod.meta?.tags ?? []).includes(tab.tag)) return false;
			return !q || searchHaystack(mod).includes(q);
		});
		const name = (m: VaultModule) => displayName(m).toLowerCase();
		switch (activeSort) {
			case "az":
				return list.sort((a, b) => name(a).localeCompare(name(b)));
			case "za":
				return list.sort((a, b) => name(b).localeCompare(name(a)));
			case "updated":
				return list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || name(a).localeCompare(name(b)));
			default:
				return list.sort(
					(a, b) => (installCounts[b.id] ?? 0) - (installCounts[a.id] ?? 0) || name(a).localeCompare(name(b)),
				);
		}
	}

	function updatableModules(): VaultModule[] {
		// User-authored (custom) modules are never vault-managed, even if a
		// vault entry happens to share their id.
		const locals = localRecords().filter((r) => !(r.metadata.tags ?? []).includes("custom"));
		const versions = new Map(locals.map((r) => [r.metadata.identifier, r.sidecar?.installed_version]));
		return catalog.modules.filter((mod) => {
			const installed = versions.get(mod.id);
			return installed !== undefined && installed !== mod.version && !catalog.revoked[mod.id];
		});
	}

	function renderUpdates() {
		const pending = updatableModules();
		updates.replaceChildren();
		updates.style.display = pending.length ? "" : "none";
		if (!pending.length) return;
		updates.appendChild(
			el("span", undefined, `${pending.length} update${pending.length === 1 ? "" : "s"} available`),
		);
		const all = el("button", "spicetify-store-cta", "Update all");
		all.addEventListener("click", async () => {
			all.disabled = true;
			for (const mod of pending) {
				try {
					await installModule(mod, setStatus);
				} catch (e) {
					setStatus(`update failed for ${mod.id}: ${(e as Error).message}`);
				}
			}
			renderAll();
		});
		updates.appendChild(all);
	}

	function installCta(mod: VaultModule, installedVersion: string | undefined): string {
		return installedVersion === undefined ? "Install" : installedVersion === mod.version ? "Reinstall" : "Update";
	}

	function runInstall(mod: VaultModule, button: HTMLButtonElement) {
		button.disabled = true;
		void installModule(mod, setStatus)
			.catch((e) => setStatus(`failed: ${(e as Error).message}`))
			.finally(() => {
				button.disabled = false;
				renderAll();
			});
	}

	function renderGrid() {
		grid.replaceChildren();
		const locals = localRecords();
		const localIds = new Set(locals.map((r) => r.metadata.identifier));
		const localVersions = new Map(locals.map((r) => [r.metadata.identifier, r.sidecar?.installed_version]));
		const states = new Map<string, any>(M().list().map((s: any) => [s.identifier, s]));
		for (const mod of visibleModules()) {
			const card = el("article", "spicetify-store-card");

			if (mod.meta?.preview) {
				const img = el("img", "spicetify-store-card-preview") as HTMLImageElement;
				img.src = mod.meta.preview;
				img.loading = "lazy";
				img.alt = "";
				card.appendChild(img);
			}
			const title = el("h3", "spicetify-store-card-name");
			const repo = deriveRepository(mod);
			if (repo) {
				const link = el("a", undefined, displayName(mod));
				link.href = repo;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				title.appendChild(link);
			} else {
				title.textContent = displayName(mod);
			}
			card.appendChild(title);
			if (mod.meta?.description) card.appendChild(el("p", "spicetify-store-card-desc", mod.meta.description));
			if (mod.meta?.authors?.length) {
				card.appendChild(el("div", "spicetify-store-card-authors", `by ${mod.meta.authors.join(", ")}`));
			}

			card.dataset.moduleId = mod.id;
			const meta = el("div", "spicetify-store-card-meta");
			meta.appendChild(badge(mod.version));
			const count = installCounts[mod.id];
			if (count !== undefined) {
				const countBadge = badge(`${count} installs`);
				countBadge.classList.add("spicetify-store-badge--count");
				meta.appendChild(countBadge);
			}
			meta.appendChild(
				badge(mod.files ? "inline ✓" : mod.checksum ? "checksum ✓" : "unverified", !!(mod.checksum || mod.files)),
			);
			try {
				const host = new URL(mod.vault).host;
				if (host) meta.appendChild(badge(host));
			} catch {}
			for (const tag of mod.meta?.tags ?? []) meta.appendChild(badge(tag));
			const state = states.get(mod.id) as { loaded?: boolean } | undefined;
			if (localIds.has(mod.id)) meta.appendChild(badge(state?.loaded ? "enabled" : "installed", true));
			card.appendChild(meta);

			const actions = el("div", "spicetify-store-card-actions");
			const install = el("button", "spicetify-store-cta", installCta(mod, localVersions.get(mod.id)));
			install.addEventListener("click", () => runInstall(mod, install));
			const details = Button({
				label: "Details",
				variant: "secondary",
				onClick: () => openModuleDetails(mod, installCta(mod, localVersions.get(mod.id)), (btn) => runInstall(mod, btn)),
			});
			actions.append(install, details);
			card.appendChild(actions);
			grid.appendChild(card);
		}
		if (!grid.childElementCount) {
			grid.appendChild(
				el(
					"div",
					"spicetify-store-empty",
					catalog.modules.length ? "No modules match your filters" : "No modules found in any vault",
				),
			);
		}
	}

	function renderInstalledGrid() {
		installedGrid.replaceChildren();
		const local = localRecords();
		installedTitle.style.display = local.length ? "" : "none";
		const states = new Map<string, any>(M().list().map((s: any) => [s.identifier, s]));
		for (const record of local) {
			const id = record.metadata.identifier;
			const state = states.get(id) as { loaded?: boolean } | undefined;
			const isProtected = PROTECTED.has(id);
			const revokedReason = catalog.revoked[id];
			const card = el(
				"article",
				`spicetify-store-card${revokedReason ? " spicetify-store-card--revoked" : ""}`,
			);

			card.appendChild(el("h3", "spicetify-store-card-name", record.metadata.name ?? id));

			const meta = el("div", "spicetify-store-card-meta");
			const version = record.sidecar?.installed_version ?? "";
			if (version) meta.appendChild(badge(version));
			for (const tag of record.metadata.tags ?? []) meta.appendChild(badge(tag));
			meta.appendChild(badge(state?.loaded ? "enabled" : "disabled", !!state?.loaded));
			if (isProtected) meta.appendChild(badge("core"));
			if (revokedReason) meta.appendChild(badge("revoked"));
			card.appendChild(meta);

			if (revokedReason) {
				card.appendChild(el("p", "spicetify-store-card-desc", `Revoked by the vault: ${revokedReason}`));
				if (state?.loaded && !autoDisabledRevoked.has(id)) {
					autoDisabledRevoked.add(id);
					void M().disable(id).then(() => {
						setStatus(`${id} disabled: revoked by the vault`);
						renderAll();
					}).catch((e: Error) => {
						// Unlatch so the next render retries.
						autoDisabledRevoked.delete(id);
						setStatus(`${id}: failed to disable revoked module: ${e.message}`);
					});
				}
			}

			// Theme modules expose their color schemes for live switching.
			const schemes = M().schemes?.(id) as { active: string; names: string[] } | null;
			if (schemes && schemes.names.length > 1) {
				const picker = Select({
					options: schemes.names.map((name) => ({ value: name, label: name || "default" })),
					value: schemes.active,
					onChange: (name) => {
						M().setScheme(id, name);
						setStatus(`${id}: ${name} scheme applied`);
					},
				});
				card.appendChild(picker);
			}

			const actions = el("div", "spicetify-store-card-actions");
			// Protected modules can be re-enabled if somehow down, but never
			// disabled (that would unload the UI) or removed.
			if (!isProtected || !state?.loaded) {
				const toggle = el("button", "spicetify-store-cta", state?.loaded ? "Disable" : "Enable");
				toggle.addEventListener("click", async () => {
					try {
						if (state?.loaded) {
							await M().disable(id);
						} else {
							await M().enable(id);
							await enforceSingleTheme(id, setStatus);
						}
					} catch (e) {
						setStatus(`failed: ${(e as Error).message}`);
					}
					renderAll();
				});
				actions.appendChild(toggle);
			}

			if ((record.metadata.tags ?? []).includes("custom") && record.files?.["index.css"] !== undefined) {
				const edit = Button({
					label: "Edit",
					variant: "secondary",
					onClick: () =>
						openSnippetEditor(
							{ id, name: record.metadata.name ?? id, css: record.files!["index.css"] },
							renderAll,
							setStatus,
						),
				});
				actions.appendChild(edit);
			}

			if (!isProtected) {
				const remove = el("button", "spicetify-store-danger", "Remove");
				remove.addEventListener("click", async () => {
					try {
						await M().removeLocal(id);
					} catch (e) {
						setStatus(`failed: ${(e as Error).message}`);
					}
					renderAll();
				});
				actions.appendChild(remove);
			}
			card.appendChild(actions);
			installedGrid.appendChild(card);
		}
	}

	function renderAll() {
		renderChips();
		renderUpdates();
		renderGrid();
		renderInstalledGrid();
	}

	search.addEventListener("input", () => {
		filter = search.value;
		renderGrid();
	});
	newSnippet.addEventListener("click", () => openSnippetEditor(null, () => renderAll(), setStatus));

	exportBtn.addEventListener("click", () => {
		const data = exportStoreData();
		const blob = new Blob([data], { type: "application/json" });
		const a = el("a") as HTMLAnchorElement;
		a.href = URL.createObjectURL(blob);
		a.download = "spicetify-store-backup.json";
		a.click();
		URL.revokeObjectURL(a.href);
		setStatus("backup downloaded");
	});
	importBtn.addEventListener("click", () => importInput.click());
	importInput.addEventListener("change", async () => {
		const file = importInput.files?.[0];
		importInput.value = "";
		if (!file) return;
		try {
			const written = importStoreData(await file.text());
			setStatus(`imported ${written} entries — restart Spotify to load the modules`);
		} catch (e) {
			setStatus(`import failed: ${(e as Error).message}`);
		}
	});
	// Two-step reset instead of a blocking confirm dialog.
	let resetArmed: ReturnType<typeof setTimeout> | null = null;
	resetBtn.addEventListener("click", () => {
		if (resetArmed) {
			clearTimeout(resetArmed);
			resetArmed = null;
			const removed = resetStoreData();
			resetBtn.textContent = "Reset";
			setStatus(`removed ${removed} entries — restart Spotify to finish`);
			renderAll();
			return;
		}
		resetBtn.textContent = "Really reset?";
		resetArmed = setTimeout(() => {
			resetBtn.textContent = "Reset";
			resetArmed = null;
		}, 4000);
	});

	// Count updates arrive asynchronously; patch badges in place instead
	// of re-sorting the grid under the user's pointer.
	onCountsChanged = () => {
		for (const card of grid.querySelectorAll<HTMLElement>("[data-module-id]")) {
			const count = installCounts[card.dataset.moduleId!];
			if (count === undefined) continue;
			const existing = card.querySelector(".spicetify-store-badge--count");
			if (existing) {
				existing.textContent = `${count} installs`;
			} else {
				const countBadge = badge(`${count} installs`);
				countBadge.classList.add("spicetify-store-badge--count");
				card.querySelector(".spicetify-store-card-meta")?.insertBefore(
					countBadge,
					card.querySelector(".spicetify-store-card-meta")!.children[1] ?? null,
				);
			}
		}
	};

	let loaded = false;
	let loading = false;
	return {
		node: page,
		async ensureLoaded() {
			// Module state changes outside this page (dev pushes, manager
			// actions); a revisit re-renders from live registry state.
			if (loaded) {
				renderAll();
				return;
			}
			// A failed load must retry on the next visit, not latch.
			if (loading) return;
			loading = true;
			setStatus("loading vaults…");
			try {
				catalog = await loadCatalog();
				// Only a load where some vault answered may latch; an offline
				// page keeps retrying on later visits.
				loaded = catalog.ok;
				setStatus(
					catalog.ok
						? (catalog.modules.length ? "" : "no modules found in any vault")
						: "vaults unreachable, will retry on the next visit",
				);
			} finally {
				loading = false;
			}
			renderAll();
			void fetchInstallCounts(catalog.modules.map((m) => m.id)).then(() => {
				if (Object.keys(installCounts).length) renderGrid();
			});
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
		disposed = true;
		for (const timer of retryTimers) clearTimeout(timer);
		retryTimers.clear();
		for (const close of openDialogClosers) close();
		openDialogClosers.clear();
		onCountsChanged = null;
		disposePage?.();
		page.node.remove();
		disposeNavlink?.();
		fallbackBtn?.remove();
		panel?.remove();
	};
}
