/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
	type Catalog,
	displayVersion,
	kindOf,
	loadCatalog,
	type ModuleKind,
	proxiedFetch,
	satisfiesRange,
	type VaultModule,
} from "./catalog.ts";
import { reportInstall } from "./counter.ts";
import { DAEMON, M, markStdlibDiskStaged, STAGING_DAEMON, stdlibDiskStaged, toast } from "./runtime.ts";

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
	// Set on a staged record when a localStorage record for the same module
	// exists that the loader refused (localWins said the staged copy wins).
	// The record is inert but real: it costs storage, it is what an "update"
	// would be written into, and until it is deleted nothing in the UI would
	// otherwise admit it exists.
	shadowedLocal?: string;
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
	const shadowed = new Map<string, string>();
	for (const record of localRecords()) {
		const state = stateById.get(record.metadata.identifier);
		if (state && !state.local) {
			shadowed.set(record.metadata.identifier, record.sidecar?.installed_version ?? record.metadata.version);
			continue;
		}
		out.push({ ...record, local: true });
	}
	const have = new Set(out.map((record) => record.metadata.identifier));
	for (const state of states) {
		if (state.local || have.has(state.identifier)) continue;
		out.push({
			metadata: metaById.get(state.identifier) ?? { identifier: state.identifier, version: state.version },
			sidecar: { installed_version: state.version },
			local: false,
			...(shadowed.has(state.identifier) ? { shadowedLocal: shadowed.get(state.identifier) } : {}),
		});
	}
	return out;
}

export function kindOfInstalled(id: string): ModuleKind {
	return kindOf(installedRecords().find((r) => r.metadata.identifier === id)?.metadata);
}

// A user-authored snippet, which the vault never governs (no update is offered
// against a catalog entry sharing its id, and it stays editable in place).
// Newer records carry a `custom` boolean; every record written before that
// carried the marker in the tag list, so both are honoured — dropping the tag
// fallback stranded existing snippets, hiding their Edit button and exposing
// them to a vault "update" that would overwrite the user's CSS.
export function isCustomRecord(metadata: { custom?: boolean; tags?: string[] } | undefined): boolean {
	return !!metadata?.custom || (metadata?.tags ?? []).includes("custom");
}

// The loader remembers the active theme by identifier. Removing that theme
// leaves the preference naming a module that is no longer there, so every
// later boot resolves it to nothing. Removing an override that a staged copy
// shadows is not an uninstall, so the module has to be gone from the registry
// before the preference is dropped.
export const ACTIVE_THEME_KEY = "spicetify:modules:activeTheme";

export function forgetActiveThemeIfRemoved(id: string): void {
	if (localStorage.getItem(ACTIVE_THEME_KEY) !== id) return;
	const stillPresent = (M().list() as Array<{ identifier: string }>).some((s) => s.identifier === id);
	if (!stillPresent) localStorage.removeItem(ACTIVE_THEME_KEY);
}

// What the loader reports back from removeLocal. `revertedTo` means the
// record it deleted was overriding a copy the CLI staged on disk, so that
// copy took over and the module is still installed and running.
type RemovalOutcome = { revertedTo?: string; requiresRestart?: boolean };

// One removal path for both surfaces, so neither can describe the outcome
// differently. removeLocal owns localStorage records and nothing else;
// calling a revert-to-staged a removal is what made "Remove" look like it
// re-added the module.
export async function removeLocalRecord(id: string, name: string): Promise<string> {
	const outcome = (await M().removeLocal(id)) as RemovalOutcome | null | undefined;
	forgetActiveThemeIfRemoved(id);
	if (outcome?.revertedTo) {
		return `${name}: store copy removed, still installed via the CLI at ${outcome.revertedTo}`;
	}
	if (outcome?.requiresRestart) return `${name} removed — restart Spotify to finish`;
	return `${name} removed`;
}

// ---------- daemon-backed removal (disk installs) ----------

// Whether a CLI-staged module can be uninstalled from in here. Both halves
// have to hold: the daemon must be up, and this client's wrapper must be new
// enough to carry the call (an older payload has the Daemon object without it).
export async function canUninstallStaged(): Promise<boolean> {
	const api = DAEMON();
	if (!api?.uninstallStaged) return false;
	try {
		return await api.available();
	} catch {
		return false;
	}
}

// Drops the module from disk and re-applies. The apply restarts Spotify, so
// this never resolves into a UI the user is still looking at.
export async function uninstallStaged(id: string, version: string): Promise<void> {
	const api = DAEMON();
	if (!api?.uninstallStaged) throw new Error("this client cannot reach the daemon");
	await api.uninstallStaged(id, version);
}

// Themes fight over the same client chrome; enabling one turns the others
// off, marketplace-style. This is enforcement, not the user disabling those
// themes, so it unloads them transiently (M().unload) rather than persisting
// a disable — otherwise activating a theme would durably disable every other
// installed theme, and re-activating one later would leave the rest off for
// good. M().unload is absent on a client applied by a pre-this-change loader;
// there disable was itself transient, so fall back to it.
export async function enforceSingleTheme(id: string): Promise<void> {
	if (kindOfInstalled(id) !== "theme") return;
	const turnOff = (mid: string) => (M().unload ?? M().disable)(mid);
	for (const state of M().list() as Array<{ identifier: string; loaded: boolean }>) {
		if (state.identifier === id || !state.loaded) continue;
		if (kindOfInstalled(state.identifier) === "theme") {
			await turnOff(state.identifier);
			toast(`disabled ${state.identifier} (one theme at a time)`);
		}
	}
}

// What an install actually did, so callers stop inferring it from whether
// the promise threw: `requiresRestart` means the new files persisted but
// only take over on the next boot (a tree module, or a dependency that is
// itself restart-gated); `enabled` means the new code is live right now.
export type InstallOutcome = { requiresRestart: boolean; enabled: boolean };

// How long a live swap may take before the update is declared restart-gated;
// unloading and re-enabling a module is normally sub-second work.
export const INSTALL_SWAP_TIMEOUT_MS = 15_000;

// One in-flight promise per id: a second caller (a dependent resolving a
// dependency two cards are racing on) joins the running install instead of
// returning early as if it had completed.
const installing = new Map<string, Promise<InstallOutcome>>();

export function installModule(mod: VaultModule, status: (msg: string) => void): Promise<InstallOutcome> {
	const inFlight = installing.get(mod.id);
	if (inFlight) {
		status(`${mod.id} is already installing`);
		return inFlight;
	}
	const run = (async () => {
		try {
			return await installModuleInner(mod, status);
		} catch (e) {
			// The toast is the only failure surface; callers just clear their
			// progress line.
			toast(`Failed to install ${mod.id}: ${(e as Error).message}`, "error");
			throw e;
		} finally {
			installing.delete(mod.id);
		}
	})();
	installing.set(mod.id, run);
	return run;
}

// ---------- dependencies ----------

type RegisteredState = { identifier: string; version: string; local: boolean };

// Whether the registered copy satisfies the range the way the loader's own
// checkDependencies will judge it: by its version, or by a historical version
// its metadata vouches for (compat) that the range admits.
function registeredSatisfies(id: string, range: string): boolean {
	const state = ((M().list?.() ?? []) as RegisteredState[]).find((s) => s.identifier === id);
	if (!state) return false;
	if (satisfiesRange(state.version, range)) return true;
	const metadata =
		(state.local ? localRecords().find((r) => r.metadata.identifier === id)?.metadata : undefined) ??
		((M().manifest?.modules ?? []) as Array<{ identifier: string; compat?: unknown }>).find(
			(m) => m.identifier === id,
		);
	const compat = metadata?.compat;
	return Array.isArray(compat) && compat.some((v: string) => satisfiesRange(v, range));
}

// A satisfying copy can already sit in localStorage waiting for a restart (a
// tree module updated earlier this session); reinstalling it would only
// re-download and toast a second time. Only a record the loader's localWins
// rule will actually accept counts: remapped against this boot's classmap and
// strictly newer than the registered copy — anything else defers to staged on
// the next boot and a restart would not help.
function pendingSatisfies(id: string, range: string): boolean {
	const record = localRecords().find((r) => r.metadata.identifier === id) as
		| {
				metadata: { identifier: string; version?: string };
				sidecar?: { installed_version?: string };
				remapKey?: string;
		  }
		| undefined;
	if (!record) return false;
	const version = record.sidecar?.installed_version ?? record.metadata.version;
	if (!version || !satisfiesRange(version, range)) return false;
	const classmapKey = M().manifest?.classmapKey;
	if (classmapKey && record.remapKey !== classmapKey) return false;
	const state = ((M().list?.() ?? []) as RegisteredState[]).find((s) => s.identifier === id);
	return !state || satisfiesRange(version, `>${state.version}`);
}

/**
 * The loader enables a fresh install against the dependency versions it has
 * registered right now, so installing a module whose new version needs a newer
 * dependency than the running one persists fine and then fails to enable.
 * Resolve that before touching the loader: bring an unsatisfied dependency up
 * from the vault first. A dependency that only applies on the next boot (a
 * tree module: its update returns requiresRestart and the registry keeps the
 * old version) cannot satisfy this session at all, so the dependent is
 * reported restart-gated rather than failed.
 */
export async function ensureDependencies(
	dependencies: Record<string, string>,
	status: (msg: string) => void,
): Promise<{ requiresRestart: boolean }> {
	let requiresRestart = false;
	let catalog: Catalog | undefined;
	for (const [dep, range] of Object.entries(dependencies)) {
		if (registeredSatisfies(dep, range)) continue;
		if (pendingSatisfies(dep, range)) {
			requiresRestart = true;
			continue;
		}
		catalog ??= await loadCatalog();
		if (!catalog.ok) {
			throw new Error(`needs ${dep}@${range}, and the vault could not be reached to install it`);
		}
		if (catalog.revoked[dep]) {
			throw new Error(`needs ${dep}, which the vault revoked: ${catalog.revoked[dep]}`);
		}
		const entry = catalog.modules.find((m) => m.id === dep);
		if (!entry || !satisfiesRange(entry.version, range)) {
			throw new Error(
				`needs ${dep}@${range}; the vault's newest is ${entry ? displayVersion(entry.version) : "none"}`,
			);
		}
		status(`installing dependency ${dep}@${displayVersion(entry.version)}…`);
		await installModule(entry, status);
		if (!registeredSatisfies(dep, range)) requiresRestart = true;
	}
	return { requiresRestart };
}

// Modules.report is a function in some loader builds and a plain object in
// others; the failure map lives behind whichever shape is present.
export function enableFailureReason(id: string): string {
	const raw: unknown = M().report;
	const report = typeof raw === "function" ? (raw as () => unknown)() : raw;
	const reason = (report as { failed?: Record<string, unknown> } | undefined)?.failed?.[id];
	return typeof reason === "string" && reason ? reason : "unknown reason";
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

// "staged": the disk copy is enabled and the marker is set.
// "already-staged": a previous run staged this exact version; nothing was
// sent and nothing should be re-reported. "pending": the request was
// dispatched but the daemon had not finished within the RPC timeout; it
// keeps working after the socket closes, so the record path must NOT run
// (it would stage the same version twice) and a retry will find the
// download already done. "unavailable": nothing was dispatched, so the
// record path is safe to take over.
export type DaemonStaging = "staged" | "already-staged" | "pending" | "unavailable";

/**
 * The record path for a stdlib update rides on the loader's import map and
 * mixes generations whenever a specifier escapes it; the disk path has no
 * such layer. The daemon resolves the checksum from the registry itself
 * (never from this caller) and refuses to stage a stdlib the registry does
 * not vouch for; the served tree only changes on the next apply, which the
 * page offers.
 */
export async function stageStdlibViaDaemon(mod: VaultModule, status: (msg: string) => void): Promise<DaemonStaging> {
	const api = STAGING_DAEMON();
	if (!api) return "unavailable";
	try {
		if (!(await api.available())) return "unavailable";
	} catch {
		return "unavailable";
	}
	if (!mod.artifacts.length) return "unavailable";
	// Already staged this exact version: re-sending would only re-download.
	if (stdlibDiskStaged() === displayVersion(mod.version)) return "already-staged";
	status(`staging stdlib@${displayVersion(mod.version)} on disk…`);
	const query = [
		`id=${encodeURIComponent(`stdlib@${mod.version}`)}`,
		...mod.artifacts.map((artifact) => `artifacts=${encodeURIComponent(artifact)}`),
	].join("&");
	try {
		// The daemon downloads and verifies the artifact before answering,
		// with serial mirror fallbacks; the default RPC timeout is sized for
		// commands that answer immediately.
		await api.send(`spicetify:stdlib:fast-enable?${query}`, { timeoutMs: 120_000 });
	} catch (e) {
		status("");
		// The wrapper's timeout means "dispatched, no answer yet", and the
		// daemon runs the command to completion after the socket dies.
		if ((e as Error).message.includes("did not answer")) return "pending";
		toast(`daemon staging failed (${(e as Error).message}); installing as a record instead`);
		return "unavailable";
	}
	// The marker stores the plain semver: the vault key can carry +cm build
	// metadata while the running version reported after an apply is the
	// module's own metadata.json version, and the two have to compare equal.
	markStdlibDiskStaged(displayVersion(mod.version));
	status("");
	return "staged";
}

async function installModuleInner(mod: VaultModule, status: (msg: string) => void): Promise<InstallOutcome> {
	if (mod.id === "stdlib") {
		const staging = await stageStdlibViaDaemon(mod, status);
		if (staging === "staged") {
			toast(`stdlib ${displayVersion(mod.version)} staged on disk; apply to bring it up`, "success");
			reportInstall(mod);
			return { requiresRestart: true, enabled: false };
		}
		if (staging === "already-staged") {
			toast(`stdlib ${displayVersion(mod.version)} is already staged; apply to bring it up`);
			return { requiresRestart: true, enabled: false };
		}
		if (staging === "pending") {
			toast("the daemon is still staging stdlib; try again in a moment");
			return { requiresRestart: true, enabled: false };
		}
	}

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
		kind: kindOf(mod.meta),
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

	const deps = await ensureDependencies(metadata.dependencies ?? {}, status);

	status("installing…");
	// installLocal unloads any prior live instance itself, transiently, so no
	// pre-disable here: a persisted disable before the install would outlive a
	// failure and silently skip the module on every later boot.
	const swap = M().installLocal(mod.id, {
		metadata,
		files,
		sidecar: {
			installed_version: mod.version,
			classmap_base: "",
			allow_stale: false,
			checksum: mod.checksum ?? "",
		},
	}) as Promise<{ requiresRestart?: boolean; disabled?: boolean } | boolean | null>;
	const name = metadata?.name ?? mod.id;
	// The loader persists the new record before it unloads the old instance,
	// so if that instance's dispose hangs (an unbounded await in module
	// teardown), the update is already durable and a restart finishes it.
	// Waiting forever here just pins "installing…" on screen.
	const result = await Promise.race([
		swap,
		new Promise<"hung-swap">((resolve) => setTimeout(() => resolve("hung-swap"), INSTALL_SWAP_TIMEOUT_MS)),
	]);
	if (result === "hung-swap") {
		status("");
		toast(`${name} installed, but the old copy would not shut down; restart Spotify to finish`, "success");
		reportInstall(mod);
		return { requiresRestart: true, enabled: false };
	}
	// Tree modules (stdlib-style) apply on the next boot; the loader keeps
	// the running code and says so instead of pretending a live swap.
	if (result && typeof result === "object" && result.requiresRestart) {
		status("");
		toast(`${name} installed; restart Spotify to apply it`, "success");
		reportInstall(mod);
		return { requiresRestart: true, enabled: false };
	}
	// Updating a module the user had turned off: the new files are in, but the
	// loader left it off on purpose. Say so rather than "failed to enable".
	if (result && typeof result === "object" && result.disabled) {
		status("");
		toast(`${name} updated; still disabled`, "success");
		reportInstall(mod);
		return { requiresRestart: false, enabled: false };
	}
	if (result) {
		status("");
		toast(`${name} installed and enabled`, "success");
		await enforceSingleTheme(mod.id);
		reportInstall(mod);
		return { requiresRestart: false, enabled: true };
	} else {
		const reason = enableFailureReason(mod.id);
		// A dependency-gated failure (" needs " is the loader's dependency
		// message; "unknown reason" is an older loader recording nothing) with
		// a restart-pending dependency is not a failure: the new files
		// persisted and the restart brings the dependency up. Any other
		// recorded reason is real and must surface.
		const depGated = deps.requiresRestart && (reason === "unknown reason" || reason.includes(" needs "));
		status("");
		if (depGated) {
			toast(`${name} installed; restart Spotify to apply it`, "success");
			reportInstall(mod);
			return { requiresRestart: true, enabled: false };
		}
		toast(`${name} installed but failed to enable: ${reason}`, "error");
		return { requiresRestart: false, enabled: false };
	}
}
