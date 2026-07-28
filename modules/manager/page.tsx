/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "/modules/stdlib/src/expose/React.ts";
import { TextInput } from "/modules/stdlib/lib/primitives.js";
import {
	deriveManagerState,
	effectiveSupport,
	fetchSupportStatus,
	show,
	showBool,
	updateAdvice,
	type ManagerModuleRow,
	type SpotifySupportStatus,
} from "./state.ts";

const M = () => (globalThis as never as Record<string, any>).Spicetify.Modules;

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

export const ManagerPage = () => {
	const [state, setState] = React.useState(deriveManagerState);
	const [filter, setFilter] = React.useState("");
	const [status, setStatus] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [support, setSupport] = React.useState<SpotifySupportStatus | null>(null);

	React.useEffect(() => {
		void fetchSupportStatus().then(setSupport);
	}, []);

	// Nudge the user once when they are on a version we do not yet support, so
	// degraded chrome is explained rather than mysterious. Driven by the
	// authoritative live feed only: on first render `support` is null and the
	// manifest snapshot could be stale, so waiting avoids a false alarm before
	// the feed resolves. The flag latches only after a real enqueue, so an
	// early boot with no Snackbar yet retries once it registers. Best-effort:
	// the persistent panel notice below still shows either way.
	React.useEffect(() => {
		if (!support) return;
		const advice = updateAdvice(state.spotifyVersion, support);
		if (advice.kind === "unsupported" && !unsupportedNoticeShown) {
			const enqueue = (globalThis as never as Record<string, any>).Spicetify?.Snackbar?.enqueueSnackbar;
			if (typeof enqueue === "function") {
				try {
					enqueue(advice.message, { variant: "warning" });
					unsupportedNoticeShown = true;
				} catch {
					/* toast is best-effort */
				}
			}
		}
	}, [state.spotifyVersion, support]);

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
				await fn();
				setStatus(`${label} done`);
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
			</section>

			{(() => {
				const sup = effectiveSupport(state, support);
				const advice = updateAdvice(state.spotifyVersion, sup);
				const policy = state.updatePolicy;
				const cmd = (text: string, label: string) => (
					<button type="button" onClick={() => void copyToClipboard(text, `${label} copied`)}>
						{label}
					</button>
				);
				return (
					<section>
						<div className="spicetify-manager-section-head">
							<h2>Updates</h2>
							<Badge kind={policy === "gate" ? "ok" : undefined}>policy: {show(policy)}</Badge>
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
							Update handling is set from a terminal. Copy a command:
						</p>
						<div className="spicetify-manager-update-actions">
							{cmd("spicetify spotify-updates gate", "gate")}
							{cmd("spicetify spotify-updates block", "block")}
							{cmd("spicetify spotify-updates unblock", "allow")}
							{advice.kind === "ready" && cmd("spicetify restore backup apply", "update & apply")}
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
