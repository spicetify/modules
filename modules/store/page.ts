/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
	type Catalog,
	categoryOf,
	corsProxy,
	deriveRepository,
	displayName,
	displayVersion,
	loadCatalog,
	searchHaystack,
	type VaultModule,
} from "./catalog.ts";
import { fetchInstallCounts, installCounts } from "./counter.ts";
import { enforceSingleTheme, installModule, localRecords } from "./install.ts";
import { Badge, Button, Chip, openDialog, Select, Textarea, TextInput } from "./kit.ts";
import { el, M, openDialogClosers, PLATFORM, setOnCountsChanged } from "./runtime.ts";
import { pendingUpdates } from "./updates.ts";

// Infrastructure modules: stdlib is the foundation every module depends
// on, and store/manager are the management surfaces themselves. Disabling
// or removing any of them from inside the client destroys the very UI
// doing it, so the store never offers those actions for them.
const PROTECTED = new Set(["stdlib", "store", "manager"]);

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
			if (line.startsWith("```")) fence = null;
			else fence.textContent += `${line}\n`;
			continue;
		}
		if (line.startsWith("```")) {
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
	// closer so a module unload tears down any open dialog. onClose fires
	// on every dismissal path (×, backdrop, programmatic), keeping the set
	// leak-free without the store owning the close affordances.
	const handle = openDialog({ title, children: [], onClose: () => openDialogClosers.delete(handle.close) });
	openDialogClosers.add(handle.close);
	return { body: handle.body, close: handle.close };
}

// ---------- snippet authoring ----------

const slugify = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "snippet";

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
	const save = Button({
		label: existing ? "Save" : "Create",
		onClick: async () => {
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
		},
	});
	actions.appendChild(save);
	body.append(nameInput, css, actions);
	nameInput.focus();
}

// ---------- module detail view ----------

function openModuleDetails(mod: VaultModule, installLabel: string, onInstall: (btn: HTMLButtonElement) => void): void {
	const { body } = openOverlay(displayName(mod));

	if (mod.meta?.preview) {
		const img = el("img", "spicetify-store-detail-preview") as HTMLImageElement;
		img.src = mod.meta.preview;
		img.alt = "";
		body.appendChild(img);
	}

	const meta = el("div", "spicetify-store-card-meta");
	meta.appendChild(Badge({ text: displayVersion(mod.version) }));
	const count = installCounts[mod.id];
	if (count !== undefined) meta.appendChild(Badge({ text: `${count} installs` }));
	// Verification only matters when there is a download to verify;
	// inline entries ship inside the vault, so there is nothing to
	// check and the tags below already say what the module is.
	if (!mod.files) {
		meta.appendChild(
			Badge({ text: mod.checksum ? "checksum ✓" : "unverified", tone: mod.checksum ? "ok" : "neutral" }),
		);
	}
	for (const tag of mod.meta?.tags ?? []) meta.appendChild(Badge({ text: tag }));
	body.appendChild(meta);

	if (mod.meta?.authors?.length) {
		const line = el("div", "spicetify-store-card-authors");
		line.append("by ");
		mod.meta.authors.forEach((author, i) => {
			if (i > 0) line.append(", ");
			// Link any author to their GitHub profile when the vault
			// knows their username (recovered from marketplace history).
			if (author.github) {
				const a = el("a", undefined, author.name);
				a.href = `https://github.com/${author.github}`;
				a.target = "_blank";
				a.rel = "noopener noreferrer";
				line.appendChild(a);
			} else {
				line.append(author.name);
			}
		});
		body.appendChild(line);
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
const ENDPOINT_KEYS = ["spicetify:defaultVaultUrl", "spicetify:corsProxyTemplate", "spicetify:installsApiUrl"];
const PREF_KEYS = ["spicetify:store:sort", "spicetify:store:tab"];

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

// ---------- full store page ----------

// Full store page on /bespoke/store, registered through stdlib's route
// register. Same standalone rule as the button: the popover panel keeps
// working without stdlib; the page is progressive enhancement.
export const STORE_ROUTE = "/bespoke/store";

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

export function createStorePage() {
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
			chips.appendChild(
				Chip({
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
				}),
			);
		}
	}

	function visibleModules(): VaultModule[] {
		const q = filter.toLowerCase();
		const tab = TABS.find((t) => t.key === activeTab);
		const list = catalog.modules.filter((mod) => {
			if (catalog.revoked[mod.id]) return false;
			// Hidden entries (infrastructure like stdlib) never render as
			// cards; the updates banner still covers them.
			if (mod.hidden) return false;
			// Previews are required: the card is artwork-first, so a
			// preview-less entry (a non-conforming community vault) has no
			// card to render.
			if (!mod.meta?.preview) return false;
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
				return list.sort(
					(a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || name(a).localeCompare(name(b)),
				);
			default:
				return list.sort(
					(a, b) => (installCounts[b.id] ?? 0) - (installCounts[a.id] ?? 0) || name(a).localeCompare(name(b)),
				);
		}
	}

	const updatableModules = (): VaultModule[] => pendingUpdates(catalog);

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

	function runRemove(mod: VaultModule, button: HTMLButtonElement) {
		button.disabled = true;
		void M()
			.removeLocal(mod.id)
			.then(() => setStatus(`${displayName(mod)} removed`))
			.catch((e: Error) => setStatus(`failed: ${e.message}`))
			.finally(() => {
				button.disabled = false;
				renderAll();
			});
	}

	function renderGrid() {
		grid.replaceChildren();
		const locals = localRecords();
		const localVersions = new Map(locals.map((r) => [r.metadata.identifier, r.sidecar?.installed_version]));
		const states = new Map<string, any>(
			M()
				.list()
				.map((s: any) => [s.identifier, s]),
		);
		for (const mod of visibleModules()) {
			const card = el("article", "spicetify-store-card spicetify-store-card--catalog");
			card.dataset.moduleId = mod.id;

			// The whole card opens the details dialog (album-card pattern);
			// inner controls (the install FAB, the repo link) stop
			// propagation so they keep their own behavior.
			const openDetails = () =>
				openModuleDetails(mod, installCta(mod, localVersions.get(mod.id)), (btn) => runInstall(mod, btn));
			card.tabIndex = 0;
			card.setAttribute("role", "button");
			card.setAttribute("aria-label", `${displayName(mod)} details`);
			card.addEventListener("click", openDetails);
			card.addEventListener("keydown", (event) => {
				if (event.target !== card) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					openDetails();
				}
			});

			const img = el("img", "spicetify-store-card-preview") as HTMLImageElement;
			img.src = mod.meta?.preview ?? "";
			img.loading = "lazy";
			img.alt = "";
			card.appendChild(img);

			// Hover-revealed circular button pinned to the card's
			// bottom-right corner: the album-card play FAB, white with a
			// glyph instead of green with a play triangle. The glyph is a
			// download while there is something to fetch (not installed,
			// or an update pending); an installed, current module gets a
			// trash glyph instead, so the corner action is removal.
			const installedVersion = localVersions.get(mod.id);
			const canRemove =
				installedVersion !== undefined && installedVersion === mod.version && !PROTECTED.has(mod.id);
			const installFab = el(
				"button",
				`spicetify-store-card-fab${canRemove ? " spicetify-store-card-fab--remove" : ""}`,
			);
			installFab.appendChild(svgIcon(canRemove ? TRASH_PATHS : DOWNLOAD_PATHS));
			const cta = canRemove ? "Remove" : installCta(mod, installedVersion);
			installFab.title = cta;
			installFab.setAttribute("aria-label", `${cta} ${displayName(mod)}`);
			installFab.addEventListener("click", (event) => {
				event.stopPropagation();
				if (canRemove) runRemove(mod, installFab);
				else runInstall(mod, installFab);
			});
			card.appendChild(installFab);

			const title = el("h3", "spicetify-store-card-name");
			const repo = deriveRepository(mod);
			if (repo) {
				const link = el("a", undefined, displayName(mod));
				link.href = repo;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				link.addEventListener("click", (event) => event.stopPropagation());
				title.appendChild(link);
			} else {
				title.textContent = displayName(mod);
			}
			card.appendChild(title);
			if (mod.meta?.description) card.appendChild(el("p", "spicetify-store-card-desc", mod.meta.description));
			if (mod.meta?.authors?.length) {
				card.appendChild(
					el("div", "spicetify-store-card-authors", `by ${mod.meta.authors.map((a) => a.name).join(", ")}`),
				);
			}

			const meta = el("div", "spicetify-store-card-meta");
			meta.appendChild(badge(displayVersion(mod.version)));
			const count = installCounts[mod.id];
			if (count !== undefined) {
				const countBadge = badge(`${count} installs`);
				countBadge.classList.add("spicetify-store-badge--count");
				meta.appendChild(countBadge);
			}
			// Category badge (snippet/theme/extension/app) says what the
			// module is; the checksum badge only appears for artifact
			// modules, where an unverified download is a real risk. Inline
			// entries ship inside the vault, so there is nothing to verify.
			const category = categoryOf(mod.meta?.tags);
			if (category) meta.appendChild(badge(category));
			if (!mod.files) meta.appendChild(badge(mod.checksum ? "checksum ✓" : "unverified", !!mod.checksum));
			try {
				const host = new URL(mod.vault).host;
				if (host) meta.appendChild(badge(host));
			} catch {}
			// No tag badges on cards: the toolbar chips already segment the
			// catalog by tag, so the badge only repeats what the active tab
			// communicates. Tags stay in the details dialog and in search.
			card.appendChild(meta);

			// Enabled state is a persistent green outline, not a badge:
			// it must read without hovering (the corner FAB, which would
			// also tell, is hover-revealed).
			const state = states.get(mod.id) as { loaded?: boolean } | undefined;
			if (state?.loaded) card.classList.add("spicetify-store-card--enabled");
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
		const states = new Map<string, any>(
			M()
				.list()
				.map((s: any) => [s.identifier, s]),
		);
		for (const record of local) {
			const id = record.metadata.identifier;
			const state = states.get(id) as { loaded?: boolean } | undefined;
			const isProtected = PROTECTED.has(id);
			const revokedReason = catalog.revoked[id];
			const card = el("article", `spicetify-store-card${revokedReason ? " spicetify-store-card--revoked" : ""}`);

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
					void M()
						.disable(id)
						.then(() => {
							setStatus(`${id} disabled: revoked by the vault`);
							renderAll();
						})
						.catch((e: Error) => {
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
	setOnCountsChanged(() => {
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
	});

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
						? catalog.modules.length
							? ""
							: "no modules found in any vault"
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

// Glyphs for the card corner FAB, filled Encore style. Built with
// createElementNS, never innerHTML (static markup rule).
function svgIcon(paths: string[]): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	for (const d of paths) {
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", d);
		svg.appendChild(path);
	}
	return svg;
}

// Download-into-tray: install or update.
const DOWNLOAD_PATHS = [
	"M12 3a1 1 0 0 1 1 1v7.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4l2.3 2.3V4a1 1 0 0 1 1-1z",
	"M5 15a1 1 0 0 1 1 1v2h12v-2a1 1 0 1 1 2 0v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z",
];

// Trash can: remove an installed module.
const TRASH_PATHS = [
	"M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2h4V4z",
	"M6.5 8h11l-.8 11.2A2.5 2.5 0 0 1 14.2 21.5H9.8a2.5 2.5 0 0 1-2.5-2.3L6.5 8z",
];
