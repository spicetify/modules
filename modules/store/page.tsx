/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The full store page as a React component tree. Same standalone rule as
// the rest of the store: nothing from stdlib is imported at the top level
// (type-only imports erase at build), so a broken stdlib can never take
// this file's module graph down with it. React, ReactDOM, and the kit
// primitives are acquired inside loadPageDeps(), which index.ts awaits in
// the same try block as loadKit(); the classic JSX pragma above compiles
// every element in this file to React.createElement against that lazy
// binding, keeping the built output free of any static react import.

import type { ReactElement, ReactNode } from "react";
import type * as KitClasses from "/modules/stdlib/lib/primitives-classes.ts";
import type * as UIKit from "/modules/stdlib/lib/primitives.tsx";
import type * as ReactExpose from "/modules/stdlib/src/expose/React.ts";

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
import { M, openDialogClosers, PLATFORM, setOnCountsChanged } from "./runtime.ts";
import { pendingUpdates } from "./updates.ts";

// ---------- lazily acquired stdlib bindings ----------

let React: typeof ReactExpose.React;
let ReactDOM: typeof ReactExpose.ReactDOM;
let Badge: typeof UIKit.Badge;
let Button: typeof UIKit.Button;
let Chip: typeof UIKit.Chip;
let Dialog: typeof UIKit.Dialog;
let Select: typeof UIKit.Select;
let badgeClass: typeof KitClasses.badgeClass;
let SEARCHBAR_CLASS: typeof KitClasses.SEARCHBAR_CLASS;

// Mirrors kit.ts: the enhanced page requires stdlib, so its dependencies
// load through dynamic imports the entry awaits inside its try block. If
// stdlib is absent or broken this rejects and index.ts drops to the
// vanilla fallback panel.
export async function loadPageDeps(): Promise<void> {
	const [expose, primitives, classes] = await Promise.all([
		import("/modules/stdlib/src/expose/React.js"),
		import("/modules/stdlib/lib/primitives.js"),
		import("/modules/stdlib/lib/primitives-classes.js"),
	]);
	({ React, ReactDOM } = expose);
	({ Badge, Button, Chip, Dialog, Select } = primitives);
	({ badgeClass, SEARCHBAR_CLASS } = classes);
}

// Infrastructure modules: stdlib is the foundation every module depends
// on, and store/manager are the management surfaces themselves. Disabling
// or removing any of them from inside the client destroys the very UI
// doing it, so the store never offers those actions for them.
const PROTECTED = new Set(["stdlib", "store", "manager"]);

// ---------- tiny safe markdown (readme rendering) ----------
// Built from text nodes and elements only; raw HTML in the source is
// rendered as text, never interpreted.

function renderInline(text: string): ReactNode[] {
	const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\((https:\/\/[^)\s]+)\))/g;
	const out: ReactNode[] = [];
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		out.push(text.slice(last, match.index));
		if (match[1]) out.push(<code key={match.index}>{match[1].slice(1, -1)}</code>);
		else if (match[2]) out.push(<strong key={match.index}>{match[2].slice(2, -2)}</strong>);
		else if (match[3]) {
			out.push(
				<a key={match.index} href={match[5]} target="_blank" rel="noopener noreferrer">
					{match[4]}
				</a>,
			);
		}
		last = match.index + match[0].length;
	}
	out.push(text.slice(last));
	return out;
}

type MdBlock =
	| { kind: "pre"; text: string }
	| { kind: "ul"; items: string[] }
	| { kind: "heading"; level: number; text: string }
	| { kind: "p"; text: string };

// Blocks are mutable while parsing (a fence keeps feeding the same pre,
// list items keep feeding the same ul) so the structure matches what the
// old line-by-line DOM builder produced.
function parseMarkdown(md: string): MdBlock[] {
	const blocks: MdBlock[] = [];
	const lines = md.split(/\r?\n/);
	let list: { kind: "ul"; items: string[] } | null = null;
	let fence: { kind: "pre"; text: string } | null = null;
	for (const line of lines) {
		if (fence) {
			if (line.startsWith("```")) fence = null;
			else fence.text += `${line}\n`;
			continue;
		}
		if (line.startsWith("```")) {
			fence = { kind: "pre", text: "" };
			blocks.push(fence);
			continue;
		}
		const item = line.match(/^\s*[-*]\s+(.*)$/);
		if (item) {
			if (!list) {
				list = { kind: "ul", items: [] };
				blocks.push(list);
			}
			list.items.push(item[1]);
			continue;
		}
		list = null;
		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			blocks.push({ kind: "heading", level: Math.min(heading[1].length + 2, 6), text: heading[2] });
			continue;
		}
		if (line.trim()) blocks.push({ kind: "p", text: line });
	}
	return blocks;
}

function Markdown(props: { md: string }): ReactElement {
	const blocks = React.useMemo(() => parseMarkdown(props.md), [props.md]);
	return (
		<div className="spicetify-store-markdown">
			{blocks.map((block, i) => {
				switch (block.kind) {
					case "pre":
						return (
							<pre key={i}>
								<code>{block.text}</code>
							</pre>
						);
					case "ul":
						return (
							<ul key={i}>
								{block.items.map((item, j) => (
									<li key={j}>{renderInline(item)}</li>
								))}
							</ul>
						);
					case "heading": {
						const H = `h${block.level}` as "h3";
						return <H key={i}>{renderInline(block.text)}</H>;
					}
					default:
						return <p key={i}>{renderInline(block.text)}</p>;
				}
			})}
		</div>
	);
}

// ---------- snippet authoring ----------

const slugify = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "snippet";

function SnippetEditor(props: {
	existing: { id: string; name: string; css: string } | null;
	onSaved: () => void;
	status: (msg: string) => void;
	onClose: () => void;
}): ReactElement {
	const { existing } = props;
	const [name, setName] = React.useState(existing?.name ?? "");
	const [css, setCss] = React.useState(existing?.css ?? "");
	const [saving, setSaving] = React.useState(false);
	// Creating over an existing snippet needs an explicit second click;
	// once armed the label stays armed, exactly like the old editor.
	const [confirmOverwrite, setConfirmOverwrite] = React.useState(false);
	const nameRef = React.useRef<HTMLInputElement>(null);
	React.useEffect(() => {
		nameRef.current?.focus();
	}, []);

	const save = async () => {
		const trimmed = name.trim();
		if (!trimmed || !css.trim()) return;
		const id = existing?.id ?? `snippet-user-${slugify(trimmed)}`;
		if (!existing && localRecords().some((r) => r.metadata.identifier === id) && !confirmOverwrite) {
			setConfirmOverwrite(true);
			return;
		}
		setSaving(true);
		try {
			try {
				await M().disable(id);
			} catch {}
			await M().installLocal(id, {
				metadata: {
					identifier: id,
					name: trimmed,
					tags: ["snippet", "custom"],
					version: "0.0.0",
					authors: [PLATFORM()?.username ?? "you"],
					description: "Custom CSS snippet",
					entries: { css: "index.css" },
					hasMixins: false,
					dependencies: {},
				},
				files: { "index.css": css },
				sidecar: { installed_version: "0.0.0", classmap_base: "", allow_stale: false, checksum: "" },
			});
			props.status(`${trimmed} applied ✓`);
			props.onClose();
			props.onSaved();
		} catch (e) {
			props.status(`snippet failed: ${(e as Error).message}`);
			setSaving(false);
		}
	};

	return (
		<Dialog title={existing ? `Edit ${existing.name}` : "New CSS snippet"} onClose={props.onClose}>
			<input
				ref={nameRef}
				type="text"
				className={SEARCHBAR_CLASS}
				placeholder="Snippet name"
				value={name}
				disabled={!!existing}
				onChange={(e) => setName(e.target.value)}
			/>
			<textarea
				className="spicetify-store-snippet-css"
				placeholder="/* your css */"
				spellCheck={false}
				value={css}
				onChange={(e) => setCss(e.target.value)}
			/>
			<div className="spicetify-store-card-actions">
				<Button disabled={saving} onClick={() => void save()}>
					{existing ? "Save" : confirmOverwrite ? "Overwrite existing?" : "Create"}
				</Button>
			</div>
		</Dialog>
	);
}

// ---------- module detail view ----------

type ReadmeState = { kind: "none" } | { kind: "loading" } | { kind: "loaded"; text: string };

function ModuleDetails(props: {
	mod: VaultModule;
	installLabel: string;
	onInstall: () => Promise<void>;
	onClose: () => void;
}): ReactElement {
	const { mod } = props;
	const [busy, setBusy] = React.useState(false);
	const [readme, setReadme] = React.useState<ReadmeState>(
		mod.meta?.readme?.startsWith("https://") ? { kind: "loading" } : { kind: "none" },
	);

	React.useEffect(() => {
		const url = mod.meta?.readme;
		if (!url?.startsWith("https://")) return;
		let stale = false;
		void fetch(corsProxy(url))
			.then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
			.then((text) => {
				if (!stale) setReadme({ kind: "loaded", text });
			})
			.catch(() => {
				if (!stale) setReadme({ kind: "none" });
			});
		return () => {
			stale = true;
		};
	}, []);

	const count = installCounts[mod.id];
	const repo = deriveRepository(mod);
	return (
		<Dialog title={displayName(mod)} onClose={props.onClose}>
			{mod.meta?.preview && <img className="spicetify-store-detail-preview" src={mod.meta.preview} alt="" />}
			<div className="spicetify-store-card-meta">
				<Badge>{displayVersion(mod.version)}</Badge>
				{count !== undefined && <Badge>{`${count} installs`}</Badge>}
				{/* Verification only matters when there is a download to verify;
				    inline entries ship inside the vault, so there is nothing to
				    check and the tags below already say what the module is. */}
				{!mod.files && (
					<Badge tone={mod.checksum ? "ok" : "neutral"}>{mod.checksum ? "checksum ✓" : "unverified"}</Badge>
				)}
				{(mod.meta?.tags ?? []).map((tag) => (
					<Badge key={tag}>{tag}</Badge>
				))}
			</div>
			{mod.meta?.authors?.length ? (
				<div className="spicetify-store-card-authors">
					{"by "}
					{mod.meta.authors.map((author, i) => (
						<React.Fragment key={`${author.name}-${i}`}>
							{i > 0 && ", "}
							{/* Link any author to their GitHub profile when the vault
							    knows their username (recovered from marketplace history). */}
							{author.github ? (
								<a
									href={`https://github.com/${author.github}`}
									target="_blank"
									rel="noopener noreferrer"
								>
									{author.name}
								</a>
							) : (
								author.name
							)}
						</React.Fragment>
					))}
				</div>
			) : null}
			{mod.meta?.description && <p>{mod.meta.description}</p>}
			{repo && (
				<a className="spicetify-store-repo-link" href={repo} target="_blank" rel="noopener noreferrer">
					{repo.replace("https://", "")}
				</a>
			)}
			<div className="spicetify-store-card-actions">
				<Button
					disabled={busy}
					onClick={() => {
						setBusy(true);
						void props.onInstall().finally(() => setBusy(false));
					}}
				>
					{props.installLabel}
				</Button>
			</div>
			{readme.kind === "loading" && <div className="spicetify-store-empty">loading readme…</div>}
			{readme.kind === "loaded" && <Markdown md={readme.text} />}
		</Dialog>
	);
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

function visibleModules(catalog: Catalog, filter: string, activeTab: string, activeSort: string): VaultModule[] {
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

function installCta(mod: VaultModule, installedVersion: string | undefined): string {
	return installedVersion === undefined ? "Install" : installedVersion === mod.version ? "Reinstall" : "Update";
}

// ---------- cards ----------

function CatalogCard(props: {
	mod: VaultModule;
	installedVersion: string | undefined;
	enabled: boolean;
	onOpenDetails: () => void;
	onInstall: () => Promise<void>;
	onRemove: () => Promise<void>;
}): ReactElement {
	const { mod } = props;
	const [busy, setBusy] = React.useState(false);

	// Hover-revealed circular button pinned to the card's bottom-right
	// corner: the album-card play FAB, white with a glyph instead of green
	// with a play triangle. The glyph is a download while there is
	// something to fetch (not installed, or an update pending); an
	// installed, current module gets a trash glyph instead, so the corner
	// action is removal.
	const canRemove =
		props.installedVersion !== undefined && props.installedVersion === mod.version && !PROTECTED.has(mod.id);
	const cta = canRemove ? "Remove" : installCta(mod, props.installedVersion);
	const repo = deriveRepository(mod);
	const count = installCounts[mod.id];
	// Category badge (snippet/theme/extension/app) says what the module
	// is; the checksum badge only appears for artifact modules, where an
	// unverified download is a real risk. Inline entries ship inside the
	// vault, so there is nothing to verify.
	const category = categoryOf(mod.meta?.tags);
	let host: string | null = null;
	try {
		host = new URL(mod.vault).host || null;
	} catch {}

	return (
		// The whole card opens the details dialog (album-card pattern);
		// inner controls (the install FAB, the repo link) stop propagation
		// so they keep their own behavior.
		<article
			className={`spicetify-store-card spicetify-store-card--catalog${
				// Enabled state is a persistent green outline, not a badge:
				// it must read without hovering (the corner FAB, which would
				// also tell, is hover-revealed).
				props.enabled ? " spicetify-store-card--enabled" : ""
			}`}
			data-module-id={mod.id}
			tabIndex={0}
			role="button"
			aria-label={`${displayName(mod)} details`}
			onClick={props.onOpenDetails}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					props.onOpenDetails();
				}
			}}
		>
			<img className="spicetify-store-card-preview" src={mod.meta?.preview ?? ""} loading="lazy" alt="" />
			<button
				type="button"
				className={`spicetify-store-card-fab${canRemove ? " spicetify-store-card-fab--remove" : ""}`}
				title={cta}
				aria-label={`${cta} ${displayName(mod)}`}
				disabled={busy}
				onClick={(event) => {
					event.stopPropagation();
					setBusy(true);
					void (canRemove ? props.onRemove() : props.onInstall()).finally(() => setBusy(false));
				}}
			>
				<GlyphIcon paths={canRemove ? TRASH_PATHS : DOWNLOAD_PATHS} />
			</button>
			<h3 className="spicetify-store-card-name">
				{repo ? (
					<a
						href={repo}
						target="_blank"
						rel="noopener noreferrer"
						onClick={(event) => event.stopPropagation()}
					>
						{displayName(mod)}
					</a>
				) : (
					displayName(mod)
				)}
			</h3>
			{mod.meta?.description && <p className="spicetify-store-card-desc">{mod.meta.description}</p>}
			{mod.meta?.authors?.length ? (
				<div className="spicetify-store-card-authors">{`by ${mod.meta.authors.map((a) => a.name).join(", ")}`}</div>
			) : null}
			<div className="spicetify-store-card-meta">
				<Badge>{displayVersion(mod.version)}</Badge>
				{count !== undefined && (
					<span className={`${badgeClass()} spicetify-store-badge--count`}>{`${count} installs`}</span>
				)}
				{category && <Badge>{category}</Badge>}
				{!mod.files && (
					<Badge tone={mod.checksum ? "ok" : "neutral"}>{mod.checksum ? "checksum ✓" : "unverified"}</Badge>
				)}
				{host && <Badge>{host}</Badge>}
				{/* No tag badges on cards: the toolbar chips already segment the
				    catalog by tag, so the badge only repeats what the active tab
				    communicates. Tags stay in the details dialog and in search. */}
			</div>
		</article>
	);
}

type LocalRecord = ReturnType<typeof localRecords>[number];

function InstalledCard(props: {
	record: LocalRecord;
	loaded: boolean;
	revokedReason: string | undefined;
	status: (msg: string) => void;
	refresh: () => void;
	onEdit: (existing: { id: string; name: string; css: string }) => void;
}): ReactElement {
	const { record } = props;
	const id = record.metadata.identifier;
	const isProtected = PROTECTED.has(id);
	const version = record.sidecar?.installed_version ?? "";
	// Theme modules expose their color schemes for live switching. The
	// pick is mirrored locally so the select reflects it immediately.
	const schemes = M().schemes?.(id) as { active: string; names: string[] } | null;
	const [schemePick, setSchemePick] = React.useState<string | null>(null);

	const toggle = async () => {
		try {
			if (props.loaded) {
				await M().disable(id);
			} else {
				await M().enable(id);
				await enforceSingleTheme(id, props.status);
			}
		} catch (e) {
			props.status(`failed: ${(e as Error).message}`);
		}
		props.refresh();
	};

	const remove = async () => {
		try {
			await M().removeLocal(id);
		} catch (e) {
			props.status(`failed: ${(e as Error).message}`);
		}
		props.refresh();
	};

	return (
		<article className={`spicetify-store-card${props.revokedReason ? " spicetify-store-card--revoked" : ""}`}>
			<h3 className="spicetify-store-card-name">{record.metadata.name ?? id}</h3>
			<div className="spicetify-store-card-meta">
				{version && <Badge>{version}</Badge>}
				{(record.metadata.tags ?? []).map((tag: string) => (
					<Badge key={tag}>{tag}</Badge>
				))}
				<Badge tone={props.loaded ? "ok" : "neutral"}>{props.loaded ? "enabled" : "disabled"}</Badge>
				{isProtected && <Badge>core</Badge>}
				{props.revokedReason && <Badge>revoked</Badge>}
			</div>
			{props.revokedReason && (
				<p className="spicetify-store-card-desc">{`Revoked by the vault: ${props.revokedReason}`}</p>
			)}
			{schemes && schemes.names.length > 1 && (
				<Select
					options={schemes.names.map((name) => ({ value: name, label: name || "default" }))}
					value={schemePick ?? schemes.active}
					onChange={(name) => {
						M().setScheme(id, name);
						setSchemePick(name);
						props.status(`${id}: ${name} scheme applied`);
					}}
				/>
			)}
			<div className="spicetify-store-card-actions">
				{/* Protected modules can be re-enabled if somehow down, but never
				    disabled (that would unload the UI) or removed. */}
				{(!isProtected || !props.loaded) && (
					<button type="button" className="spicetify-store-cta" onClick={() => void toggle()}>
						{props.loaded ? "Disable" : "Enable"}
					</button>
				)}
				{(record.metadata.tags ?? []).includes("custom") && record.files?.["index.css"] !== undefined && (
					<Button
						variant="secondary"
						onClick={() =>
							props.onEdit({ id, name: record.metadata.name ?? id, css: record.files!["index.css"] })
						}
					>
						Edit
					</Button>
				)}
				{!isProtected && (
					<button type="button" className="spicetify-store-danger" onClick={() => void remove()}>
						Remove
					</button>
				)}
			</div>
		</article>
	);
}

// ---------- page component ----------

type Overlay =
	| { kind: "details"; mod: VaultModule; installLabel: string }
	| { kind: "snippet"; existing: { id: string; name: string; css: string } | null };

// The bridge between the imperative page contract (ensureLoaded on every
// route visit) and the mounted component.
type PageApi = { onRevisit: (() => void) | null };

function StorePage(props: { api: PageApi }): ReactElement {
	const [catalog, setCatalog] = React.useState<Catalog>({ modules: [], revoked: {}, ok: false });
	const [filter, setFilter] = React.useState("");
	const [activeTab, setActiveTab] = React.useState(
		() => globalThis.localStorage?.getItem("spicetify:store:tab") ?? "all",
	);
	const [activeSort, setActiveSort] = React.useState(() => {
		const stored = globalThis.localStorage?.getItem("spicetify:store:sort") ?? "installs";
		return SORTS.some((s) => s.key === stored) ? stored : "installs";
	});
	const [status, setStatus] = React.useState("");
	const [overlay, setOverlay] = React.useState<Overlay | null>(null);
	const [updatingAll, setUpdatingAll] = React.useState(false);
	const [resetArmed, setResetArmed] = React.useState(false);
	// Module state changes outside this page (dev pushes, manager
	// actions); bumping the epoch re-reads live registry state, the React
	// equivalent of the old renderAll().
	const [registryEpoch, setRegistryEpoch] = React.useState(0);
	// The initial install-count fetch re-sorts the grid once it lands.
	const [sortEpoch, setSortEpoch] = React.useState(0);
	// Later count updates only need a re-render so badges re-read
	// installCounts; the sort memo below deliberately ignores this bump.
	const [, bumpCounts] = React.useReducer((n: number) => n + 1, 0);
	const loadedRef = React.useRef(false);
	const loadingRef = React.useRef(false);
	const autoDisabledRevoked = React.useRef(new Set<string>());
	const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const importInput = React.useRef<HTMLInputElement>(null);

	const refreshRegistry = () => setRegistryEpoch((n) => n + 1);

	const load = React.useCallback(async () => {
		// A failed load must retry on the next visit, not latch.
		if (loadingRef.current) return;
		loadingRef.current = true;
		setStatus("loading vaults…");
		let next: Catalog = { modules: [], revoked: {}, ok: false };
		try {
			next = await loadCatalog();
			// Only a load where some vault answered may latch; an offline
			// page keeps retrying on later visits.
			loadedRef.current = next.ok;
			setCatalog(next);
			setStatus(
				next.ok
					? next.modules.length
						? ""
						: "no modules found in any vault"
					: "vaults unreachable, will retry on the next visit",
			);
		} finally {
			loadingRef.current = false;
		}
		void fetchInstallCounts(next.modules.map((m) => m.id)).then(() => {
			if (Object.keys(installCounts).length) setSortEpoch((n) => n + 1);
		});
	}, []);

	React.useEffect(() => {
		void load();
	}, [load]);

	// A revisit re-renders from live registry state, or retries the
	// catalog when no vault has answered yet.
	React.useEffect(() => {
		props.api.onRevisit = () => {
			if (loadedRef.current) refreshRegistry();
			else void load();
		};
		return () => {
			props.api.onRevisit = null;
		};
	}, [load]);

	// Count updates arrive asynchronously; refresh badges in place instead
	// of re-sorting the grid under the user's pointer.
	React.useEffect(() => {
		setOnCountsChanged(() => bumpCounts());
		return () => setOnCountsChanged(null);
	}, []);

	React.useEffect(
		() => () => {
			if (resetTimer.current) clearTimeout(resetTimer.current);
		},
		[],
	);

	const locals = localRecords();
	const localVersions = new Map(locals.map((r) => [r.metadata.identifier, r.sidecar?.installed_version]));
	const states = new Map<string, any>(
		M()
			.list()
			.map((s: any) => [s.identifier, s]),
	);
	const pending = pendingUpdates(catalog);

	const visible = React.useMemo(
		() => visibleModules(catalog, filter, activeTab, activeSort),
		[catalog, filter, activeTab, activeSort, sortEpoch, registryEpoch],
	);

	// Revoked modules that are still loaded get force-disabled, latched so
	// a re-render does not re-fire an in-flight disable.
	React.useEffect(() => {
		const liveStates = new Map<string, any>(
			M()
				.list()
				.map((s: any) => [s.identifier, s]),
		);
		for (const record of localRecords()) {
			const id = record.metadata.identifier;
			if (!catalog.revoked[id]) continue;
			const state = liveStates.get(id) as { loaded?: boolean } | undefined;
			if (!state?.loaded || autoDisabledRevoked.current.has(id)) continue;
			autoDisabledRevoked.current.add(id);
			void M()
				.disable(id)
				.then(() => {
					setStatus(`${id} disabled: revoked by the vault`);
					refreshRegistry();
				})
				.catch((e: Error) => {
					// Unlatch so the next render retries.
					autoDisabledRevoked.current.delete(id);
					setStatus(`${id}: failed to disable revoked module: ${e.message}`);
				});
		}
	}, [catalog, registryEpoch]);

	const runInstall = async (mod: VaultModule) => {
		try {
			await installModule(mod, setStatus);
		} catch (e) {
			setStatus(`failed: ${(e as Error).message}`);
		} finally {
			refreshRegistry();
		}
	};

	const runRemove = async (mod: VaultModule) => {
		try {
			await M().removeLocal(mod.id);
			setStatus(`${displayName(mod)} removed`);
		} catch (e) {
			setStatus(`failed: ${(e as Error).message}`);
		} finally {
			refreshRegistry();
		}
	};

	const updateAll = async () => {
		setUpdatingAll(true);
		for (const mod of pending) {
			try {
				await installModule(mod, setStatus);
			} catch (e) {
				setStatus(`update failed for ${mod.id}: ${(e as Error).message}`);
			}
		}
		setUpdatingAll(false);
		refreshRegistry();
	};

	const openDetails = (mod: VaultModule) =>
		setOverlay({ kind: "details", mod, installLabel: installCta(mod, localVersions.get(mod.id)) });

	const onExport = () => {
		const data = exportStoreData();
		const blob = new Blob([data], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = "spicetify-store-backup.json";
		a.click();
		URL.revokeObjectURL(a.href);
		setStatus("backup downloaded");
	};

	const onImportFile = async (file: File) => {
		try {
			const written = importStoreData(await file.text());
			setStatus(`imported ${written} entries — restart Spotify to load the modules`);
		} catch (e) {
			setStatus(`import failed: ${(e as Error).message}`);
		}
	};

	// Two-step reset instead of a blocking confirm dialog.
	const onReset = () => {
		if (resetTimer.current) {
			clearTimeout(resetTimer.current);
			resetTimer.current = null;
			setResetArmed(false);
			const removed = resetStoreData();
			setStatus(`removed ${removed} entries — restart Spotify to finish`);
			refreshRegistry();
			return;
		}
		setResetArmed(true);
		resetTimer.current = setTimeout(() => {
			resetTimer.current = null;
			setResetArmed(false);
		}, 4000);
	};

	return (
		<div className="spicetify-store-page">
			<header className="spicetify-store-page-header">
				<div>
					<h1>Module Store</h1>
					<p className="spicetify-store-page-subtitle">Modules from your trusted vaults</p>
				</div>
				<input
					type="text"
					className={`${SEARCHBAR_CLASS} spicetify-store-page-search`}
					placeholder="Search modules…"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
				/>
			</header>
			<div className="spicetify-store-toolbar">
				<div className="spicetify-store-chips">
					{TABS.map((tab) => (
						<Chip
							key={tab.key}
							active={tab.key === activeTab}
							onClick={() => {
								setActiveTab(tab.key);
								try {
									localStorage.setItem("spicetify:store:tab", tab.key);
								} catch {}
							}}
						>
							{tab.label}
						</Chip>
					))}
				</div>
				<Select
					options={SORTS.map((sort) => ({ value: sort.key, label: sort.label }))}
					value={activeSort}
					onChange={(value) => {
						setActiveSort(value);
						try {
							localStorage.setItem("spicetify:store:sort", value);
						} catch {}
					}}
				/>
				<button
					type="button"
					className="spicetify-store-cta"
					onClick={() => setOverlay({ kind: "snippet", existing: null })}
				>
					New snippet
				</button>
			</div>
			<div className="spicetify-store-updates" style={pending.length ? undefined : { display: "none" }}>
				{pending.length > 0 && (
					<>
						<span>{`${pending.length} update${pending.length === 1 ? "" : "s"} available`}</span>
						<button
							type="button"
							className="spicetify-store-cta"
							disabled={updatingAll}
							onClick={() => void updateAll()}
						>
							Update all
						</button>
					</>
				)}
			</div>
			<div className="spicetify-store-status">{status}</div>
			<div className="spicetify-store-grid">
				{visible.map((mod) => (
					<CatalogCard
						key={mod.id}
						mod={mod}
						installedVersion={localVersions.get(mod.id)}
						enabled={!!(states.get(mod.id) as { loaded?: boolean } | undefined)?.loaded}
						onOpenDetails={() => openDetails(mod)}
						onInstall={() => runInstall(mod)}
						onRemove={() => runRemove(mod)}
					/>
				))}
				{visible.length === 0 && (
					<div className="spicetify-store-empty">
						{catalog.modules.length ? "No modules match your filters" : "No modules found in any vault"}
					</div>
				)}
			</div>
			<h2 className="spicetify-store-section-title" style={locals.length ? undefined : { display: "none" }}>
				Installed
			</h2>
			<div className="spicetify-store-grid">
				{locals.map((record) => (
					<InstalledCard
						key={record.metadata.identifier}
						record={record}
						loaded={!!(states.get(record.metadata.identifier) as { loaded?: boolean } | undefined)?.loaded}
						revokedReason={catalog.revoked[record.metadata.identifier]}
						status={setStatus}
						refresh={refreshRegistry}
						onEdit={(existing) => setOverlay({ kind: "snippet", existing })}
					/>
				))}
			</div>
			<div className="spicetify-store-data-row">
				<span className="spicetify-store-data-label">Store data:</span>
				<button type="button" onClick={onExport}>
					Export
				</button>
				<button type="button" onClick={() => importInput.current?.click()}>
					Import
				</button>
				<input
					ref={importInput}
					type="file"
					accept="application/json"
					style={{ display: "none" }}
					onChange={(event) => {
						const input = event.currentTarget;
						const file = input.files?.[0];
						input.value = "";
						if (file) void onImportFile(file);
					}}
				/>
				<button type="button" className="spicetify-store-danger" onClick={onReset}>
					{resetArmed ? "Really reset?" : "Reset"}
				</button>
			</div>
			{overlay?.kind === "details" && (
				<ModuleDetails
					mod={overlay.mod}
					installLabel={overlay.installLabel}
					onInstall={() => runInstall(overlay.mod)}
					onClose={() => setOverlay(null)}
				/>
			)}
			{overlay?.kind === "snippet" && (
				<SnippetEditor
					existing={overlay.existing}
					onSaved={refreshRegistry}
					status={setStatus}
					onClose={() => setOverlay(null)}
				/>
			)}
		</div>
	);
}

// ---------- page factory (contract shared with index.ts) ----------

export function createStorePage(): { node: HTMLElement; ensureLoaded: () => Promise<void> } {
	// The node exists before any React so index.ts can hold and mount it
	// through the route host ref; the React root renders into it lazily.
	const node = document.createElement("div");
	const api: PageApi = { onRevisit: null };
	let root: ReturnType<typeof ReactDOM.createRoot> | null = null;
	return {
		node,
		async ensureLoaded() {
			if (!root) {
				// ensureLoaded fires from the route host's ref, i.e. inside the
				// client tree's commit phase. During boot that is a bad moment
				// to start a second concurrent root: the scheduled render can
				// silently never flush (observed on clean staged boots; fine on
				// every later visit). Defer the first render past the client's
				// commit, and never keep a root whose commit did not land —
				// a latched dead root would leave the page blank until module
				// reload, and the next visit retrying is the honest degrade.
				await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
				if (root) {
					// A concurrent ensureLoaded won the race while we waited.
					api.onRevisit?.();
					return;
				}
				const mounted = ReactDOM.createRoot(node);
				root = mounted;
				// Dialogs portal into document.body, so removing the node on
				// unload would strand an open one. Registering the unmount as
				// a dialog closer lets index.ts's dispose tear the whole tree
				// (and any portal) down through the existing registry.
				const closer = () => mounted.unmount();
				openDialogClosers.add(closer);
				mounted.render(<StorePage api={api} />);
				await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
				if (node.childElementCount === 0) {
					console.warn("[store] page render did not commit; releasing the root to retry on next visit");
					mounted.unmount();
					openDialogClosers.delete(closer);
					root = null;
				}
				return;
			}
			api.onRevisit?.();
		},
	};
}

// Glyphs for the card corner FAB, filled Encore style.
function GlyphIcon(props: { paths: string[] }): ReactElement {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			{props.paths.map((d) => (
				<path d={d} key={d} />
			))}
		</svg>
	);
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
