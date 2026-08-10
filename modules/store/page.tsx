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
	type BackupSnippet,
	isOwnedKey,
	isPrefKey,
	parseBackup,
	serializeBackup,
	USER_SNIPPET_PREFIX,
} from "./backup.ts";
import {
	type Catalog,
	compareVersions,
	deriveRepository,
	displayName,
	displayVersion,
	kindOf,
	type ModuleKind,
	loadCatalog,
	proxiedFetch,
	searchHaystack,
	type VaultModule,
} from "./catalog.ts";
import { fetchInstallCounts, installCounts } from "./counter.ts";
import {
	ACTIVE_THEME_KEY,
	canUninstallStaged,
	enforceSingleTheme,
	type InstalledRecord,
	installedRecords,
	installModule,
	isCustomRecord,
	localRecords,
	removeLocalRecord,
	uninstallStaged,
} from "./install.ts";
import { M, openDialogClosers, PLATFORM, setOnCountsChanged, toast } from "./runtime.ts";
import { pendingUpdates } from "./updates.ts";

// ---------- lazily acquired stdlib bindings ----------

let React: typeof ReactExpose.React;
let ReactDOM: typeof ReactExpose.ReactDOM;
let Badge: typeof UIKit.Badge;
let Button: typeof UIKit.Button;
let Chip: typeof UIKit.Chip;
let Dialog: typeof UIKit.Dialog;
let Select: typeof UIKit.Select;
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
	({ SEARCHBAR_CLASS } = classes);
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
			} catch (e) {
				// Nothing to disable the first time a snippet is saved; the
				// install below is what has to succeed.
				void e;
			}
			await M().installLocal(id, {
				metadata: {
					identifier: id,
					name: trimmed,
					kind: "snippet",
					// User-authored, so the vault never governs it: no update
					// is ever offered against a catalog entry that happens to
					// share the id, and it stays editable in place.
					custom: true,
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
	installDisabled: boolean;
	canActivate: boolean;
	onActivate: () => Promise<void>;
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
		void proxiedFetch(url)
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
				{/* The dialog has no tab around it to imply the kind, so it
				    always states it. */}
				<Badge>{kindOf(mod.meta)}</Badge>
				{count !== undefined && count > 0 && (
					<InstallsBadge count={count} className="spicetify-store-installs-inline" />
				)}
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
			{mod.meta?.description && <p className="spicetify-store-detail-desc">{mod.meta.description}</p>}
			<div className="spicetify-store-card-actions">
				{/* Activating closes the dialog: the point is seeing the theme
				    take over the client behind it. */}
				{props.canActivate && (
					<Button
						disabled={busy}
						onClick={() => {
							setBusy(true);
							void props
								.onActivate()
								.finally(() => setBusy(false))
								.then(() => props.onClose());
						}}
					>
						Activate
					</Button>
				)}
				<Button
					disabled={busy || props.installDisabled}
					onClick={() => {
						setBusy(true);
						void props.onInstall().finally(() => setBusy(false));
					}}
				>
					{props.installLabel}
				</Button>
				{repo && (
					<a className="spicetify-store-repo-link" href={repo} target="_blank" rel="noopener noreferrer">
						{repo.replace("https://", "")}
					</a>
				)}
				{/* The terms the code arrives under belong next to the install
				    button, not buried in a repository somewhere. */}
				{mod.meta?.license && <span className="spicetify-store-license">{mod.meta.license}</span>}
			</div>
			{readme.kind === "loading" && <div className="spicetify-store-empty">loading readme…</div>}
			{readme.kind === "loaded" && <Markdown md={readme.text} />}
		</Dialog>
	);
}

// ---------- store data (backup / restore / reset) ----------

function exportStoreData(installed: string[], snippets: BackupSnippet[]): string {
	const prefs: Record<string, string> = {};
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i)!;
		if (isPrefKey(key)) prefs[key] = localStorage.getItem(key)!;
	}
	return serializeBackup(prefs, installed, snippets);
}

function restorePrefs(prefs: Record<string, string>): number {
	for (const [key, value] of Object.entries(prefs)) localStorage.setItem(key, value);
	return Object.keys(prefs).length;
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

// The kind is how the catalog is segmented, which is why cards no longer
// repeat it as a badge.
const TABS: Array<{ key: string; label: string; kind?: ModuleKind }> = [
	{ key: "all", label: "All" },
	{ key: "extension", label: "Extensions", kind: "extension" },
	{ key: "theme", label: "Themes", kind: "theme" },
	{ key: "snippet", label: "Snippets", kind: "snippet" },
	{ key: "app", label: "Apps", kind: "app" },
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
		if (tab?.kind && kindOf(mod.meta) !== tab.kind) return false;
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

// One resolution of a card's install state, shared by the catalog card and
// the details dialog so their actions can never disagree.
//
// "Current" differs by source: a local record converges on whatever the
// vault says, so only an exact match is current; a CLI-staged install can
// only be overridden by a strictly newer local copy (the loader's localWins
// rule), so anything the vault cannot better counts as current.
//
// Priority: an installed, inactive theme activates (themes switch from the
// gallery, marketplace-style); an active/current local install removes; a
// current CLI install is an inert tell; everything else installs/updates.
function installState(mod: VaultModule, installedVersion: string | undefined, localInstall: boolean, enabled: boolean) {
	const current =
		installedVersion !== undefined &&
		(localInstall ? installedVersion === mod.version : compareVersions(mod.version, installedVersion) <= 0);
	const canActivate = current && kindOf(mod.meta) === "theme" && !enabled;
	const canRemove = current && !canActivate && localInstall && !PROTECTED.has(mod.id);
	// stagedCurrent gates the install action everywhere (a reinstall would
	// be shadowed); cliCurrent is the FAB's inert tell, which activation
	// outranks.
	const stagedCurrent = current && !localInstall;
	const cliCurrent = stagedCurrent && !canActivate;
	const cta = canActivate
		? "Activate"
		: canRemove
			? "Remove"
			: cliCurrent
				? "Installed via CLI"
				: installCta(mod, installedVersion);
	return { canActivate, canRemove, cliCurrent, stagedCurrent, cta };
}

// ---------- cards ----------

function CatalogCard(props: {
	mod: VaultModule;
	installedVersion: string | undefined;
	localInstall: boolean;
	enabled: boolean;
	// Only true when the grid is showing more than one kind at once.
	showKind: boolean;
	onOpenDetails: () => void;
	onInstall: () => Promise<void>;
	onRemove: () => Promise<void>;
	onActivate: () => Promise<void>;
}): ReactElement {
	const { mod } = props;
	const [busy, setBusy] = React.useState(false);

	// Hover-revealed circular button pinned to the card's bottom-right
	// corner: the album-card play FAB, white with a glyph instead of green
	// with a play triangle. The glyph is a download while there is
	// something to fetch, a brush when an installed theme can be activated,
	// a trash can when the corner action is removal, and an inert check for
	// a current CLI-staged install (see installState).
	const { canActivate, canRemove, cliCurrent, cta } = installState(
		mod,
		props.installedVersion,
		props.localInstall,
		props.enabled,
	);
	const repo = deriveRepository(mod);
	const count = installCounts[mod.id];

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
			<div className="spicetify-store-card-art">
				<img className="spicetify-store-card-preview" src={mod.meta?.preview ?? ""} loading="lazy" alt="" />
				{count !== undefined && count > 0 && (
					<InstallsBadge count={count} className="spicetify-store-installs" />
				)}
			</div>
			<button
				type="button"
				className={`spicetify-store-card-fab${canRemove ? " spicetify-store-card-fab--remove" : ""}${
					cliCurrent ? " spicetify-store-card-fab--installed" : ""
				}`}
				title={cliCurrent ? "Installed via the CLI (spicetify pkg)" : cta}
				aria-label={cliCurrent ? `${displayName(mod)} installed via the CLI` : `${cta} ${displayName(mod)}`}
				aria-disabled={cliCurrent || undefined}
				disabled={busy}
				onClick={(event) => {
					// The inert installed tell has no action of its own; letting
					// the click bubble keeps the corner opening details instead
					// of being a dead zone.
					if (cliCurrent) return;
					event.stopPropagation();
					setBusy(true);
					void (canActivate ? props.onActivate() : canRemove ? props.onRemove() : props.onInstall()).finally(
						() => setBusy(false),
					);
				}}
			>
				<GlyphIcon
					paths={
						canActivate ? BRUSH_PATHS : canRemove ? TRASH_PATHS : cliCurrent ? CHECK_PATHS : DOWNLOAD_PATHS
					}
				/>
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
			<div className="spicetify-store-card-meta">
				<Badge>{displayVersion(mod.version)}</Badge>
				{/* Only where it tells you something. On a filtered tab every
				    card would repeat the tab's own name; on All the grid mixes
				    themes, extensions, snippets and apps, and without this
				    there is nothing on a card to tell them apart. Installs
				    live on the artwork, and the vault host and checksum are
				    not user-facing (a mismatched download fails the install
				    loudly, so a "checksum" badge only ever states the normal
				    case). */}
				{props.showKind && <Badge>{kindOf(mod.meta)}</Badge>}
			</div>
		</article>
	);
}

// Themes are exclusive (enforceSingleTheme), so the one active theme gets
// a persistent full-width bar above the results instead of hiding its
// controls down in the Installed section.
function ActiveThemeBar(props: {
	record: InstalledRecord;
	status: (msg: string) => void;
	refresh: () => void;
}): ReactElement {
	const id = props.record.metadata.identifier;
	const schemes = M().schemes?.(id) as { active: string; names: string[] } | null;
	// The pick is mirrored locally so the select reflects it immediately.
	const [schemePick, setSchemePick] = React.useState<string | null>(null);

	const disable = async () => {
		try {
			await M().disable(id);
			props.status(`${id} disabled`);
		} catch (e) {
			props.status(`failed: ${(e as Error).message}`);
		}
		props.refresh();
	};

	return (
		<div className="spicetify-store-active-theme">
			<span className="spicetify-store-active-theme-label">Active theme</span>
			<strong className="spicetify-store-active-theme-name">{props.record.metadata.name ?? id}</strong>
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
			<button type="button" className="spicetify-store-cta" onClick={() => void disable()}>
				Disable
			</button>
		</div>
	);
}

function InstalledCard(props: {
	record: InstalledRecord;
	loaded: boolean;
	revokedReason: string | undefined;
	daemonReady: boolean;
	status: (msg: string) => void;
	refresh: () => void;
	onEdit: (existing: { id: string; name: string; css: string }) => void;
}): ReactElement {
	const { record } = props;
	const id = record.metadata.identifier;
	const isProtected = PROTECTED.has(id);
	const version = record.sidecar?.installed_version ?? "";

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
			props.status(await removeLocalRecord(id, record.metadata.name ?? id));
		} catch (e) {
			props.status(`failed: ${(e as Error).message}`);
		}
		props.refresh();
	};

	// Uninstalling a disk install runs an apply, which restarts Spotify, so it
	// is armed first rather than fired from a single click. Same two-step
	// shape as the page's Reset.
	const [uninstallArmed, setUninstallArmed] = React.useState(false);
	React.useEffect(() => {
		if (!uninstallArmed) return;
		const timer = setTimeout(() => setUninstallArmed(false), 4000);
		return () => clearTimeout(timer);
	}, [uninstallArmed]);

	const uninstallFromDisk = async () => {
		if (!uninstallArmed) {
			setUninstallArmed(true);
			return;
		}
		setUninstallArmed(false);
		try {
			props.status(`uninstalling ${id} and re-applying — Spotify will restart…`);
			await uninstallStaged(id, version);
		} catch (e) {
			props.status(`failed: ${(e as Error).message}`);
			props.refresh();
		}
	};

	return (
		<article className={`spicetify-store-card${props.revokedReason ? " spicetify-store-card--revoked" : ""}`}>
			<h3 className="spicetify-store-card-name">{record.metadata.name ?? id}</h3>
			<div className="spicetify-store-card-meta">
				{version && <Badge>{version}</Badge>}
				<Badge tone={props.loaded ? "ok" : "neutral"}>{props.loaded ? "enabled" : "disabled"}</Badge>
				{isProtected && <Badge>core</Badge>}
				{!record.local && <Badge>cli</Badge>}
				{record.shadowedLocal && <Badge>shadowed</Badge>}
				{props.revokedReason && <Badge>revoked</Badge>}
			</div>
			{props.revokedReason && (
				<p className="spicetify-store-card-desc">{`Revoked by the vault: ${props.revokedReason}`}</p>
			)}
			{record.shadowedLocal && (
				<p className="spicetify-store-card-desc">
					{`Store copy ${record.shadowedLocal} will never run — the CLI install of ${version} wins.`}
				</p>
			)}
			<div className="spicetify-store-card-actions">
				{/* Protected modules can be re-enabled if somehow down, but never
				    disabled (that would unload the UI) or removed. */}
				{(!isProtected || !props.loaded) && (
					<button type="button" className="spicetify-store-cta" onClick={() => void toggle()}>
						{props.loaded ? "Disable" : "Enable"}
					</button>
				)}
				{isCustomRecord(record.metadata) && record.files?.["index.css"] !== undefined && (
					<Button
						variant="secondary"
						onClick={() =>
							props.onEdit({ id, name: record.metadata.name ?? id, css: record.files!["index.css"] })
						}
					>
						Edit
					</Button>
				)}
				{!isProtected && record.local && (
					<button type="button" className="spicetify-store-danger" onClick={() => void remove()}>
						Remove
					</button>
				)}
				{/* An inert record removeLocal can delete without touching what
				    is running, so it is not the danger action Remove is. */}
				{record.shadowedLocal && (
					<Button variant="secondary" onClick={() => void remove()}>
						Discard copy
					</Button>
				)}
				{/* CLI-staged installs live on disk, out of removeLocal's reach.
				    The daemon can do the real uninstall; without it this stays a
				    terminal act (spicetify pkg delete) and no button is offered. */}
				{!isProtected && !record.local && props.daemonReady && (
					<button type="button" className="spicetify-store-danger" onClick={() => void uninstallFromDisk()}>
						{uninstallArmed ? "Confirm — restarts Spotify" : "Uninstall"}
					</button>
				)}
			</div>
		</article>
	);
}

// ---------- page component ----------

type Overlay =
	| { kind: "details"; mod: VaultModule; installLabel: string; installDisabled: boolean; canActivate: boolean }
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
	// Probed once per mount: the daemon is optional, and a disk uninstall is
	// only offered when it can actually be carried out.
	const [daemonReady, setDaemonReady] = React.useState(false);
	// The initial install-count fetch re-sorts the grid once it lands.
	const [sortEpoch, setSortEpoch] = React.useState(0);
	// Later count updates only need a re-render so badges re-read
	// installCounts; the sort memo below deliberately ignores this bump.
	const [, bumpCounts] = React.useReducer((n: number) => n + 1, 0);
	const loadedRef = React.useRef(false);
	const loadingRef = React.useRef(false);
	const loadedAtRef = React.useRef(0);
	const autoDisabledRevoked = React.useRef(new Set<string>());
	const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const importInput = React.useRef<HTMLInputElement>(null);

	const refreshRegistry = () => setRegistryEpoch((n) => n + 1);

	const load = React.useCallback(async (background = false) => {
		// A failed load must retry on the next visit, not latch.
		if (loadingRef.current) return;
		loadingRef.current = true;
		// A background refresh keeps the current grid on screen instead
		// of flashing a loading state over it.
		if (!background) setStatus("loading vaults…");
		let next: Catalog = { modules: [], revoked: {}, ok: false };
		try {
			next = await loadCatalog();
			if (background && !next.ok) return; // keep the last good catalog
			// Only a load where some vault answered may latch; an offline
			// page keeps retrying on later visits.
			loadedRef.current = next.ok;
			if (next.ok) loadedAtRef.current = Date.now();
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

	React.useEffect(() => {
		let live = true;
		void canUninstallStaged().then((ready) => {
			if (live) setDaemonReady(ready);
		});
		return () => {
			live = false;
		};
	}, []);

	// A revisit re-renders from live registry state, retries the catalog
	// when no vault has answered yet, and refreshes a stale catalog in
	// the background: modules publish continuously, so a latched catalog
	// must not outlive the session (that hid freshly published themes
	// until a client restart).
	const CATALOG_TTL_MS = 5 * 60 * 1000;
	React.useEffect(() => {
		props.api.onRevisit = () => {
			if (!loadedRef.current) {
				void load();
				return;
			}
			refreshRegistry();
			if (Date.now() - loadedAtRef.current > CATALOG_TTL_MS) void load(true);
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

	const installed = installedRecords();
	const installedVersions = new Map(installed.map((r) => [r.metadata.identifier, r.sidecar?.installed_version]));
	const localIds = new Set(installed.filter((r) => r.local).map((r) => r.metadata.identifier));
	const states = new Map<string, any>(
		M()
			.list()
			.map((s: any) => [s.identifier, s]),
	);
	const pending = pendingUpdates(catalog);
	const activeTheme = installed.find(
		(r) =>
			kindOf(r.metadata) === "theme" &&
			!!(states.get(r.metadata.identifier) as { loaded?: boolean } | undefined)?.loaded,
	);

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
		for (const record of installedRecords()) {
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

	// Theme switching from the gallery: enabling loads the theme (the
	// loader unloads the previous one first, so there is no overlap) and
	// the single-theme sweep catches anything the registry missed. Toasts,
	// not the inline status line, because activation also runs from the
	// details dialog, which covers the status line.
	const runActivate = async (mod: VaultModule) => {
		try {
			await M().enable(mod.id);
			await enforceSingleTheme(mod.id, setStatus);
			toast(`${displayName(mod)} is now the active theme`, "success");
		} catch (e) {
			toast(`Failed to activate ${displayName(mod)}: ${(e as Error).message}`, "error");
		} finally {
			refreshRegistry();
		}
	};

	const runRemove = async (mod: VaultModule) => {
		try {
			setStatus(await removeLocalRecord(mod.id, displayName(mod)));
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

	const openDetails = (mod: VaultModule) => {
		const state = installState(
			mod,
			installedVersions.get(mod.id),
			localIds.has(mod.id),
			!!(states.get(mod.id) as { loaded?: boolean } | undefined)?.loaded,
		);
		setOverlay({
			kind: "details",
			mod,
			installLabel: state.stagedCurrent ? "Installed via CLI" : installCta(mod, installedVersions.get(mod.id)),
			installDisabled: state.stagedCurrent,
			canActivate: state.canActivate,
		});
	};

	const onExport = () => {
		// What a restore can actually put back: registry modules by id, and
		// user-written snippets by content. A CLI-staged module is on disk and
		// stays there, and reinstalling it through the store would only turn a
		// disk install into a localStorage record the loader then shadows;
		// stdlib, store and manager are likewise never reinstalled from a file.
		const restorable = installed
			.filter((record) => record.local)
			.map((record) => record.metadata.identifier)
			.filter((id) => !PROTECTED.has(id) && !id.startsWith(USER_SNIPPET_PREFIX));
		const snippets: BackupSnippet[] = localRecords()
			.filter((record) => String(record.metadata?.identifier ?? "").startsWith(USER_SNIPPET_PREFIX))
			.map((record) => ({
				id: record.metadata.identifier as string,
				name: record.metadata?.name as string | undefined,
				css: String(record.files?.["index.css"] ?? ""),
			}))
			.filter((snippet) => snippet.css);
		const data = exportStoreData(restorable, snippets);
		const blob = new Blob([data], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = "spicetify-store-backup.json";
		a.click();
		URL.revokeObjectURL(a.href);
		setStatus("backup downloaded");
	};

	// Restore reinstalls from the vault rather than from the file: the file
	// names modules, the catalog supplies the checksummed artifact. Anything
	// the vault no longer carries is named instead of silently dropped.
	const onImportFile = async (file: File) => {
		try {
			const plan = parseBackup(await file.text());
			// Prefs first, so the restored disabled set is in place before the
			// reinstalls: installLocal reads it and leaves those modules off
			// instead of force-enabling them.
			const restored = restorePrefs(plan.prefs);
			const missing: string[] = [];
			let reinstalled = 0;
			for (const id of plan.modules) {
				const mod = catalog.modules.find((m) => m.id === id);
				if (!mod || catalog.revoked[id]) {
					missing.push(id);
					continue;
				}
				try {
					await installModule(mod, setStatus);
					reinstalled++;
				} catch (e) {
					missing.push(`${id} (${(e as Error).message})`);
				}
			}
			// User snippets are not in any registry, so the file's own
			// stylesheet is the only copy there is. Restored the way the
			// editor saves them, and only ever as CSS.
			let snippetsRestored = 0;
			for (const snippet of plan.snippets) {
				try {
					await M().installLocal(snippet.id, {
						metadata: {
							identifier: snippet.id,
							name: snippet.name ?? snippet.id.slice(USER_SNIPPET_PREFIX.length),
							kind: "snippet",
							custom: true,
							version: "0.0.0",
							authors: [PLATFORM()?.username ?? "you"],
							description: "Custom CSS snippet",
							entries: { css: "index.css" },
							hasMixins: false,
							dependencies: {},
						},
						files: { "index.css": snippet.css },
						sidecar: { installed_version: "0.0.0", classmap_base: "", allow_stale: false, checksum: "" },
					});
					snippetsRestored++;
				} catch (e) {
					missing.push(`${snippet.id} (${(e as Error).message})`);
				}
			}

			// Each theme reinstall calls activeThemePref.set, so the last one
			// installed, not the backed-up one, ends up active. Re-assert the
			// backup's choice and bring it up live so persisted and running
			// state both match it.
			const activeTheme = plan.prefs[ACTIVE_THEME_KEY];
			if (
				activeTheme &&
				kindOf(installedRecords().find((r) => r.metadata.identifier === activeTheme)?.metadata) === "theme"
			) {
				localStorage.setItem(ACTIVE_THEME_KEY, activeTheme);
				try {
					await M().enable(activeTheme);
					await enforceSingleTheme(activeTheme, setStatus);
				} catch (e) {
					void e;
				}
			}
			const skipped = missing.length ? `; not in the vault: ${missing.join(", ")}` : "";
			const snippetNote = snippetsRestored ? `, ${snippetsRestored} snippet(s)` : "";
			setStatus(
				`restored ${restored} preference(s), reinstalled ${reinstalled} module(s)${snippetNote}${skipped}`,
			);
		} catch (e) {
			setStatus(`import failed: ${(e as Error).message}`);
		} finally {
			refreshRegistry();
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
								} catch (e) {
									// Remembering the tab is a convenience; storage being
									// unavailable must not stop the tab from switching.
									void e;
								}
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
						} catch (e) {
							// As above: the sort still applies even if it cannot be
							// remembered for next time.
							void e;
						}
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
			{activeTheme && (
				<ActiveThemeBar
					key={activeTheme.metadata.identifier}
					record={activeTheme}
					status={setStatus}
					refresh={refreshRegistry}
				/>
			)}
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
						installedVersion={installedVersions.get(mod.id)}
						localInstall={localIds.has(mod.id)}
						enabled={!!(states.get(mod.id) as { loaded?: boolean } | undefined)?.loaded}
						showKind={activeTab === "all"}
						onOpenDetails={() => openDetails(mod)}
						onInstall={() => runInstall(mod)}
						onRemove={() => runRemove(mod)}
						onActivate={() => runActivate(mod)}
					/>
				))}
				{visible.length === 0 && (
					<div className="spicetify-store-empty">
						{catalog.modules.length ? "No modules match your filters" : "No modules found in any vault"}
					</div>
				)}
			</div>
			<h2 className="spicetify-store-section-title" style={installed.length ? undefined : { display: "none" }}>
				Installed
			</h2>
			<div className="spicetify-store-grid">
				{installed.map((record) => (
					<InstalledCard
						key={record.metadata.identifier}
						record={record}
						loaded={!!(states.get(record.metadata.identifier) as { loaded?: boolean } | undefined)?.loaded}
						revokedReason={catalog.revoked[record.metadata.identifier]}
						daemonReady={daemonReady}
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
					installDisabled={overlay.installDisabled}
					canActivate={overlay.canActivate}
					onActivate={() => runActivate(overlay.mod)}
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

const nextMacrotask = () => new Promise((r) => setTimeout(r, 0));

// Drive the root's first commit to completion. The ref that calls this fires
// inside the client tree's commit phase during boot, where a fresh concurrent
// root's render can be starved and never flush. Re-rendering nudges a stuck
// commit; poll between attempts and resolve as soon as the node gets children.
// Returns false only if nothing commits within the window (a genuine hang),
// so the caller can release the root and let the next visit retry.
async function driveCommit(root: ReturnType<typeof ReactDOM.createRoot>, node: HTMLElement, tree: ReactElement) {
	const start = Date.now();
	for (let attempt = 0; Date.now() - start < 4000; attempt++) {
		if (attempt > 0) root.render(tree);
		for (let f = 0; f < 8; f++) {
			await new Promise((r) => requestAnimationFrame(r));
			if (node.childElementCount > 0) return true;
		}
	}
	return node.childElementCount > 0;
}

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
				// The ref that calls this fires inside the client tree's commit
				// phase; yield to a macrotask so the client finishes painting
				// before a second root starts, then drive the first commit to
				// completion (see driveCommit).
				await nextMacrotask();
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
				const tree = <StorePage api={api} />;
				mounted.render(tree);
				if (!(await driveCommit(mounted, node, tree))) {
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

// Paintbrush: activate an installed theme.
const BRUSH_PATHS = [
	"M20.8 3.2a2.3 2.3 0 0 0-3.3 0L10 10.7l3.3 3.3 7.5-7.5a2.3 2.3 0 0 0 0-3.3z",
	"M9 12a4 4 0 0 0-4 4c0 1.2-.6 2.1-1.6 2.7-.4.2-.4.8 0 1 1.6.8 3.6 1.2 5.3.6a5 5 0 0 0 3.3-4.3L9 12z",
];

// Checkmark: installed and current via the CLI, nothing for the store to do.
const CHECK_PATHS = [
	"M20.1 6.3a1 1 0 0 1 0 1.4l-9.5 9.5a1 1 0 0 1-1.4 0L4.4 12.4a1 1 0 1 1 1.4-1.4l4.1 4.1 8.8-8.8a1 1 0 0 1 1.4 0z",
];

// Trash can: remove an installed module.
const TRASH_PATHS = [
	"M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2h4V4z",
	"M6.5 8h11l-.8 11.2A2.5 2.5 0 0 1 14.2 21.5H9.8a2.5 2.5 0 0 1-2.5-2.3L6.5 8z",
];

// Downward tray: the install-count glyph.
const INSTALLS_PATHS = [
	"M12 3a1 1 0 0 1 1 1v9.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4l2.3 2.3V4a1 1 0 0 1 1-1z",
	"M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z",
];

// Compact, human install count: 1200 -> 1.2k.
function formatCount(n: number): string {
	if (n < 1000) return String(n);
	const k = n / 1000;
	return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

function InstallsBadge(props: { count: number; className: string }): ReactElement {
	return (
		<span className={props.className} title={`${props.count} install${props.count === 1 ? "" : "s"}`}>
			<GlyphIcon paths={INSTALLS_PATHS} />
			{formatCount(props.count)}
		</span>
	);
}
