/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { proxiedFetch, type VaultModule } from "./catalog.ts";
import { reportInstall } from "./counter.ts";
import { M, toast } from "./runtime.ts";

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- install / lifecycle ----------

export function localRecords(): Array<{ metadata: any; sidecar?: any; files?: Record<string, string> }> {
	return M().listLocal();
}

export type InstalledRecord = {
	metadata: any;
	sidecar?: any;
	files?: Record<string, string>;
	// false: staged on disk by the CLI (pkg install/enable + apply), so it has
	// no localStorage record and removeLocal cannot touch it.
	local: boolean;
};

// Everything installed, one record per module, describing the copy that is
// actually running. The registry's `local` flag is authoritative: a
// localStorage record the loader shadowed (localWins refused it) is not the
// running install, so the staged entry represents that module instead —
// otherwise the shadowed record's version would drive update offers the
// loader is guaranteed to refuse. Staged metadata comes from the manifest;
// the synthesized sidecar carries the running version so comparisons work
// uniformly.
export function installedRecords(): InstalledRecord[] {
	const states = (M().list?.() ?? []) as Array<{ identifier: string; version: string; local: boolean }>;
	const stateById = new Map(states.map((state) => [state.identifier, state]));
	const metaById = new Map<string, any>(
		((M().manifest?.modules ?? []) as Array<{ identifier: string }>).map((m) => [m.identifier, m]),
	);
	const out: InstalledRecord[] = [];
	for (const record of localRecords()) {
		const state = stateById.get(record.metadata.identifier);
		if (state && !state.local) continue;
		out.push({ ...record, local: true });
	}
	const have = new Set(out.map((record) => record.metadata.identifier));
	for (const state of states) {
		if (state.local || have.has(state.identifier)) continue;
		out.push({
			metadata: metaById.get(state.identifier) ?? { identifier: state.identifier, version: state.version },
			sidecar: { installed_version: state.version },
			local: false,
		});
	}
	return out;
}

export function tagsOfInstalled(id: string): string[] {
	const record = installedRecords().find((r) => r.metadata.identifier === id);
	return record?.metadata?.tags ?? [];
}

// The loader remembers the active theme by identifier. Removing that theme
// leaves the preference naming a module that is no longer there, so every
// later boot resolves it to nothing. Removing an override that a staged copy
// shadows is not an uninstall, so the module has to be gone from the registry
// before the preference is dropped.
const ACTIVE_THEME_KEY = "spicetify:modules:activeTheme";

export function forgetActiveThemeIfRemoved(id: string): void {
	if (localStorage.getItem(ACTIVE_THEME_KEY) !== id) return;
	const stillPresent = (M().list() as Array<{ identifier: string }>).some((s) => s.identifier === id);
	if (!stillPresent) localStorage.removeItem(ACTIVE_THEME_KEY);
}

// Themes fight over the same client chrome; enabling one disables the
// others, marketplace-style.
export async function enforceSingleTheme(id: string, status: (msg: string) => void): Promise<void> {
	if (!tagsOfInstalled(id).includes("theme")) return;
	for (const state of M().list() as Array<{ identifier: string; loaded: boolean }>) {
		if (state.identifier === id || !state.loaded) continue;
		if (tagsOfInstalled(state.identifier).includes("theme")) {
			await M().disable(state.identifier);
			status(`disabled ${state.identifier} (one theme at a time)`);
		}
	}
}

const installing = new Set<string>();

export async function installModule(mod: VaultModule, status: (msg: string) => void) {
	if (installing.has(mod.id)) {
		status(`${mod.id} is already installing`);
		return;
	}
	installing.add(mod.id);
	try {
		await installModuleInner(mod, status);
	} catch (e) {
		// Surface failures as a native toast too (callers still show inline detail).
		toast(`Failed to install ${mod.id}: ${(e as Error).message}`, "error");
		throw e;
	} finally {
		installing.delete(mod.id);
	}
}

/**
 * Artifacts are listed in preference order, author's host first and this
 * org's mirror after it. A host that has gone away (a deleted release asset)
 * is an availability failure the checksum cannot help with, so try the rest
 * of the list before giving up; whichever one answers is still verified
 * against the same checksum.
 */
async function downloadArtifact(mod: VaultModule, status: (msg: string) => void): Promise<ArrayBuffer> {
	const failures: string[] = [];
	for (const [index, url] of mod.artifacts.entries()) {
		if (index > 0) status(`trying mirror ${index} of ${mod.artifacts.length - 1}…`);
		try {
			const res = await proxiedFetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return await res.arrayBuffer();
		} catch (e) {
			failures.push(`${url}: ${(e as Error).message}`);
		}
	}
	throw new Error(`download failed: ${failures.join("; ")}`);
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
		const zipBytes = await downloadArtifact(mod, status);

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
			if (path === "metadata.json") {
				try {
					metadata = JSON.parse(text);
				} catch (e) {
					// The artifact is third-party: a malformed manifest should name
					// itself rather than surface as a bare SyntaxError mid-install.
					throw new Error(`artifact metadata.json is not valid JSON: ${(e as Error).message}`);
				}
			} else files[path] = text;
		}
		if (!metadata) throw new Error("artifact has no metadata.json");
	}

	metadata ??= {
		name: mod.meta?.name ?? mod.id,
		tags: mod.meta?.tags ?? [],
		version: mod.version,
		// The installed record mirrors metadata.json, where authors are
		// plain names.
		authors: (mod.meta?.authors ?? []).map((a) => a.name),
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
	} catch (e) {
		// Nothing to disable on a first install, which is the common path;
		// the install below is what actually has to succeed.
		void e;
	}
	const result = await M().installLocal(mod.id, {
		metadata,
		files,
		sidecar: {
			installed_version: mod.version,
			classmap_base: "",
			allow_stale: false,
			checksum: mod.checksum ?? "",
		},
	});
	// Tree modules (stdlib-style) apply on the next boot; the loader keeps
	// the running code and says so instead of pretending a live swap.
	if (result && typeof result === "object" && (result as { requiresRestart?: boolean }).requiresRestart) {
		status("");
		toast(`${metadata?.name ?? mod.id} installed; restart Spotify to apply it`, "success");
		reportInstall(mod);
		return;
	}
	if (result) {
		status("");
		toast(`${metadata?.name ?? mod.id} installed and enabled`, "success");
		await enforceSingleTheme(mod.id, status);
		reportInstall(mod);
	} else {
		const reason = M().report?.failed?.[mod.id] ?? "unknown reason";
		status("");
		toast(`${metadata?.name ?? mod.id} installed but failed to enable: ${reason}`, "error");
	}
}
