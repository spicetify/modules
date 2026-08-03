/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { corsProxy, type VaultModule } from "./catalog.ts";
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

export function tagsOfLocal(id: string): string[] {
	const record = localRecords().find((r) => r.metadata.identifier === id);
	return record?.metadata?.tags ?? [];
}

// Themes fight over the same client chrome; enabling one disables the
// others, marketplace-style.
export async function enforceSingleTheme(id: string, status: (msg: string) => void): Promise<void> {
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
	} catch {}
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
