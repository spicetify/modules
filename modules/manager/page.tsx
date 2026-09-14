/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { client, React, type DaemonCapabilities, type UpdateAndApplyStatus } from "/modules/stdlib/mod.ts";
import { TextInput } from "/modules/stdlib/lib/primitives.js";
import {
	deriveManagerState,
	deriveStaleStaged,
	describeAction,
	effectiveSupport,
	fetchPublishedVersions,
	fetchSupportStatus,
	show,
	showBool,
	updateAdvice,
	type ManagerModuleRow,
	type SpotifyAvailabilityStatus,
} from "./state.ts";
import { retryNotice } from "./notice.ts";

const M = () => client.modules;

const LEVEL_CLASS: Record<string, string> = {
	error: "spicetify-manager-diag--error",
	warn: "spicetify-manager-diag--warn",
};

// Infrastructure modules: disabling or removing them from inside the
// client tears down the management UI itself. stdlib is the foundation
// (its unload cascades to every dependent, so it also cannot be reloaded);
// store and manager are the two management surfaces.
const CORE = new Set(["stdlib", "store", "manager"]);

// The unsupported-version toast fires at most once per session; the panel
// notice (below) is the persistent surface.
let unsupportedNoticeShown = false;

const Badge = ({ kind, children }: { kind?: "ok" | "bad"; children: React.ReactNode }) => (
	<span className={`spicetify-manager-badge${kind ? ` spicetify-manager-badge--${kind}` : ""}`}>{children}</span>
);

const ModuleRow = ({
	row,
	busy,
	onAction,
}: {
	row: ManagerModuleRow;
	busy: boolean;
	onAction: (label: string, fn: () => Promise<unknown>) => void;
}) => {
	const deps = Object.entries(row.dependencies)
		.map(([id, range]) => `${id}@${range}`)
		.join(", ");
	const isCore = CORE.has(row.id);
	return (
		<div className="spicetify-manager-module">
			<div className="spicetify-manager-module__head">
				<span className="spicetify-manager-module__name">{row.id}</span>
				<Badge>{row.version}</Badge>
				<Badge>{row.source}</Badge>
				{isCore && <Badge>core</Badge>}
				{row.loaded && <Badge kind="ok">loaded</Badge>}
				{!row.loaded && !row.failed && <Badge>disabled</Badge>}
				{row.mixedIn && <Badge>mixins</Badge>}
				{row.failed !== undefined && <Badge kind="bad">failed</Badge>}
			</div>
			{deps && <div className="spicetify-manager-module__deps">needs {deps}</div>}
			{row.failed !== undefined && <div className="spicetify-manager-module__failure">{row.failed}</div>}
			<div className="spicetify-manager-module__actions">
				{row.loaded ? (
					<>
						{!isCore && (
							<button
								type="button"
								disabled={busy}
								onClick={() => onAction(`disable ${row.id}`, () => M().disable(row.id))}
							>
								Disable
							</button>
						)}
						{row.id !== "stdlib" && (
							<button
								type="button"
								disabled={busy}
								onClick={() => onAction(`reload ${row.id}`, () => M().reload(row.id))}
							>
								Reload
							</button>
						)}
						{isCore && <span className="spicetify-manager-module__note">core module</span>}
					</>
				) : (
					<button
						type="button"
						disabled={busy}
						onClick={() => onAction(`enable ${row.id}`, () => M().enable(row.id))}
					>
						Enable
					</button>
				)}
				{row.source === "local" && !isCore && (
					<button
						type="button"
						className="spicetify-manager-danger"
						disabled={busy}
						onClick={() => onAction(`remove ${row.id}`, () => M().removeLocal(row.id))}
					>
						Remove
					</button>
				)}
			</div>
		</div>
	);
};

// The daemon surface the wrapper exposes. Absent on a client patched by an
// older apply, and unusable when the daemon is not running, so the panel has
// to degrade to copy-a-command rather than assume it.
type DaemonMethod = "apply" | "blockUpdates" | "unblockUpdates";
type DaemonApi = DaemonCapabilities & Record<DaemonMethod, () => Promise<unknown>>;

const daemonApi = (): DaemonApi | null => (client.daemon as DaemonApi | undefined) ?? null;

export const ManagerPage = () => {
	const [state, setState] = React.useState(deriveManagerState);
	const [filter, setFilter] = React.useState("");
	const [status, setStatus] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [support, setSupport] = React.useState<SpotifyAvailabilityStatus | null>(null);
	const [daemon, setDaemon] = React.useState<DaemonApi | null>(null);
	const [updateAndApplySupported, setUpdateAndApplySupported] = React.useState<boolean | null>(null);
	const [updateStatus, setUpdateStatus] = React.useState<UpdateAndApplyStatus>({ kind: "idle" });

	React.useEffect(() => {
		let cancelled = false;
		let probing = false;
		const probe = async () => {
			if (probing) return;
			probing = true;
			try {
				const api = daemonApi();
				const up = (await api?.available?.()) ?? false;
				if (cancelled) return;
				const supported = up && api ? ((await api.updateAndApplySupported?.()) ?? null) : null;
				if (cancelled) return;
				setDaemon(up && api ? api : null);
				setUpdateAndApplySupported(supported);
			} finally {
				probing = false;
			}
		};
		void probe();
		const timer = globalThis.setInterval(() => void probe(), 5000);
		return () => {
			cancelled = true;
			globalThis.clearInterval(timer);
		};
	}, []);

	React.useEffect(() => daemon?.updateAndApply?.observe(setUpdateStatus), [daemon]);

	React.useEffect(() => {
		void fetchSupportStatus().then(setSupport);
	}, []);

	const [published, setPublished] = React.useState<Record<string, string> | null>(null);
	React.useEffect(() => {
		void fetchPublishedVersions().then(setPublished);
	}, []);
	const staleStaged = React.useMemo(
		() => (published ? deriveStaleStaged(state.modules, published) : []),
		[state.modules, published],
	);

	// Nudge the user once when they are on a version we do not yet support, so
	// degraded chrome is explained rather than mysterious. Support comes from
	// the local manifest, so an unavailable availability feed cannot suppress
	// the warning. Snackbar registers asynchronously; retry briefly instead of
	// requiring an unrelated state change to make the one-shot effect run again.
	React.useEffect(() => {
		const advice = updateAdvice(state.spotifyVersion, effectiveSupport(state, support));
		if (advice.kind !== "unsupported" || unsupportedNoticeShown) return;
		const notify = () => {
			const enqueue = client.snackbar?.enqueueSnackbar;
			if (typeof enqueue === "function") {
				try {
					enqueue(advice.message, { variant: "warning" });
					unsupportedNoticeShown = true;
					return true;
				} catch {
					/* toast is best-effort */
				}
			}
			return false;
		};
		return retryNotice(notify);
	}, [state.spotifyVersion, state.classmapSpotify, state.classmapVerified, state.supportedSpotify, support]);

	// Diagnostics and module state arrive asynchronously; a light poll keeps
	// the page honest while it is mounted.
	React.useEffect(() => {
		const timer = setInterval(() => setState(deriveManagerState()), 2000);
		return () => clearInterval(timer);
	}, []);

	const onAction = (label: string, fn: () => Promise<unknown>) => {
		setBusy(true);
		setStatus(`${label}…`);
		void (async () => {
			try {
				setStatus(describeAction(label, await fn()));
			} catch (e) {
				setStatus(`${label} failed: ${(e as Error).message}`);
			} finally {
				setBusy(false);
				setState(deriveManagerState());
			}
		})();
	};

	const copyToClipboard = async (text: string, done: string) => {
		if (!navigator.clipboard) {
			setStatus("clipboard unavailable in this client");
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			setStatus(done);
		} catch (e) {
			setStatus(`copy failed: ${(e as Error).message}`);
		}
	};

	// A paste-ready environment summary for bug reports: versions, flags,
	// update status, and every module's state.
	const copyEnvironment = () => {
		const advice = updateAdvice(state.spotifyVersion, effectiveSupport(state, support));
		const lines = [
			`Spotify: ${show(state.spotifyVersion)}`,
			`classmap: ${show(state.classmapKey)}`,
			`CLI: ${show(state.cliVersion)}`,
			`updates blocked: ${showBool(state.updatesBlocked)}`,
			`transforms: ${state.transformsEnabled ? "on" : "off"}`,
			`modules: ${state.loadedCount}/${state.modules.length} loaded${
				state.failedCount ? `, ${state.failedCount} failed` : ""
			}`,
			`update status: ${advice.message}`,
			...staleStaged.map((r) => `stale staged: ${r.id}@${r.staged} (${r.published} published)`),
			"",
			"modules:",
			...state.modules.map(
				(m) =>
					`  - ${m.id}@${m.version} [${m.source}] ${
						m.loaded ? "loaded" : m.failed !== undefined ? `failed: ${m.failed}` : "disabled"
					}`,
			),
		];
		void copyToClipboard(lines.join("\n"), "environment copied");
	};

	const copyDiagnostics = () => {
		const text = state.diagnostics
			.map((d) => `${new Date(d.ts).toISOString()} [${d.level}] ${d.message}`)
			.join("\n");
		void copyToClipboard(text, "diagnostics copied");
	};

	const q = filter.toLowerCase();
	const visible = state.modules.filter((m) => m.id.toLowerCase().includes(q));

	return (
		<div className="spicetify-manager-page">
			<header className="spicetify-manager-header">
				<div>
					<h1>Spicetify Manager</h1>
					<p className="spicetify-manager-subtitle">
						Runtime control for modules, boot health, and diagnostics
					</p>
				</div>
				<TextInput placeholder="Filter modules…" value={filter} onInput={setFilter} />
			</header>

			<div className="spicetify-manager-status">{status}</div>

			<section>
				<div className="spicetify-manager-section-head">
					<h2>Environment</h2>
					<button type="button" onClick={copyEnvironment}>
						Copy details
					</button>
				</div>
				<div className="spicetify-manager-env">
					<Badge>Spotify {show(state.spotifyVersion)}</Badge>
					<Badge>classmap {show(state.classmapKey)}</Badge>
					<Badge>CLI {show(state.cliVersion)}</Badge>
					<Badge kind={state.updatesBlocked ? "ok" : undefined}>
						updates blocked: {showBool(state.updatesBlocked)}
					</Badge>
					<Badge>transforms: {state.transformsEnabled ? "on" : "off"}</Badge>
					<Badge kind={state.failedCount ? "bad" : "ok"}>
						modules: {state.loadedCount}/{state.modules.length} loaded
						{state.failedCount ? `, ${state.failedCount} failed` : ""}
					</Badge>
				</div>
				<p className="spicetify-manager-note">
					Installing or staging modules on disk happens outside the client — after changing staged modules,
					run <code>spicetify restore backup apply</code>.
				</p>
				{staleStaged.length > 0 && (
					<>
						<div className="spicetify-manager-env">
							{staleStaged.map((row) => (
								<Badge key={row.id} kind="bad">
									staged {row.id}@{row.staged} — {row.published} published
								</Badge>
							))}
						</div>
						<p className="spicetify-manager-note">
							These staged modules are behind the vault and never update on their own — a stale stdlib is
							how fixes silently fail to arrive. Refresh the copies under{" "}
							<code>~/.config/spicetify/Modules</code>, then run{" "}
							<code>spicetify restore backup apply</code>.
						</p>
					</>
				)}
			</section>

			{(() => {
				const sup = effectiveSupport(state, support);
				const advice = updateAdvice(state.spotifyVersion, sup);
				const cmd = (text: string, label: string) => (
					<button type="button" onClick={() => void copyToClipboard(text, `${label} copied`)}>
						{label}
					</button>
				);
				// Every one of these restarts Spotify: apply rebuilds the served
				// tree, and the update policy is patched into Spotify's binary,
				// which cannot happen while it runs.
				const run = (label: string, fn: () => Promise<unknown>) => (
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							if (!globalThis.confirm(`${label}: Spotify will restart. Continue?`)) return;
							onAction(label, fn);
						}}
					>
						{label}
					</button>
				);
				const action = (label: string, method: DaemonMethod, fallback: string) =>
					daemon ? run(label, () => daemon[method]()) : cmd(fallback, label);
				const updateMessage = (() => {
					switch (updateStatus.kind) {
						case "idle":
							return null;
						case "accepted":
							return "Update accepted. Spotify's updater is starting.";
						case "waiting-for-update":
							return "Waiting for Spotify to offer the verified update.";
						case "downloading":
							return `Downloading Spotify ${updateStatus.targetVersion}.`;
						case "installing-spotify":
							return `Installing Spotify ${updateStatus.targetVersion}. Spotify will restart.`;
						case "applying-spicetify":
							return `Spotify ${updateStatus.targetVersion} is installed; reapplying the customization.`;
						case "securing":
							return updateStatus.message ?? "Restoring and verifying the Spotify update block.";
						case "complete":
							return `Updated Spotify ${updateStatus.fromVersion} → ${updateStatus.toVersion}, reapplied Spicetify, and restored the update block.`;
						case "failed-safe":
							return `Update stopped safely: ${updateStatus.message}`;
					}
				})();
				return (
					<section>
						<div className="spicetify-manager-section-head">
							<h2>Updates</h2>
						</div>
						<div className="spicetify-manager-env">
							<Badge>installed {show(state.spotifyVersion)}</Badge>
							<Badge kind={sup?.supportedSpotify ? "ok" : undefined}>
								supported {show(sup?.supportedSpotify)}
							</Badge>
							<Badge>available {show(sup?.latestSpotify)}</Badge>
						</div>
						<p className={`spicetify-manager-update spicetify-manager-update--${advice.kind}`}>
							{advice.message}
						</p>
						{state.classmapFallback && (
							<p className="spicetify-manager-update spicetify-manager-update--unsupported">
								Running on a fallback classmap: this Spotify build has no verified classmap yet, so some
								chrome may be off. It self-heals once one ships.
							</p>
						)}
						<p className="spicetify-manager-note">
							{daemon
								? updateAndApplySupported === true
									? "Update handling runs through the local daemon. Spotify restarts."
									: updateAndApplySupported === false
										? "One-step Update & Apply is unavailable on this platform or Spotify client. Choose allow, update Spotify normally, then run spicetify apply."
										: "One-step Update & Apply needs a current daemon and wrapper. Restart the daemon or run spicetify self-update and spicetify apply; otherwise choose allow, update Spotify normally, then run spicetify apply."
								: "The daemon is not running, so these are set from a terminal. Copy a command:"}
						</p>
						{updateMessage && (
							<p
								className={`spicetify-manager-update spicetify-manager-update--${updateStatus.kind === "securing" && updateStatus.manualRecovery ? "unsupported" : "ready"}`}
							>
								{updateMessage}
							</p>
						)}
						<div className="spicetify-manager-update-actions">
							{action("block", "blockUpdates", "spicetify spotify-updates block")}
							{action("allow", "unblockUpdates", "spicetify spotify-updates unblock")}
							{advice.kind === "ready" &&
								(updateAndApplySupported && daemon?.updateAndApply
									? run("update & apply", async () => {
											const admission = await daemon.updateAndApply!();
											return admission.disposition === "joined"
												? "joined existing update"
												: "update accepted";
										})
									: updateAndApplySupported === null
										? cmd("spicetify self-update && spicetify apply", "copy update instructions")
										: cmd("spicetify apply", "copy apply command"))}
						</div>
					</section>
				);
			})()}

			<section>
				<h2>Modules</h2>
				<div className="spicetify-manager-modules">
					{visible.map((row) => (
						<ModuleRow key={row.id} row={row} busy={busy} onAction={onAction} />
					))}
					{!visible.length && (
						<div className="spicetify-manager-empty">
							{state.modules.length ? "No modules match the filter" : "No modules installed"}
						</div>
					)}
				</div>
			</section>

			<section>
				<div className="spicetify-manager-section-head">
					<h2>Diagnostics</h2>
					<button type="button" onClick={copyDiagnostics} disabled={!state.diagnostics.length}>
						Copy all
					</button>
				</div>
				<div className="spicetify-manager-diag">
					{state.diagnostics.map((d, i) => (
						<div key={i} className={`spicetify-manager-diag__entry ${LEVEL_CLASS[d.level] ?? ""}`}>
							<span className="spicetify-manager-diag__time">{new Date(d.ts).toLocaleTimeString()}</span>
							<span>{d.message}</span>
						</div>
					))}
					{!state.diagnostics.length && (
						<div className="spicetify-manager-empty">No diagnostics recorded</div>
					)}
				</div>
			</section>
		</div>
	);
};
