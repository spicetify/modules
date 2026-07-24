/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "/modules/stdlib/src/expose/React.ts";
import {
	deriveManagerState,
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

const Badge = ({ kind, children }: { kind?: "ok" | "bad"; children: React.ReactNode }) => (
	<span className={`spicetify-manager-badge${kind ? ` spicetify-manager-badge--${kind}` : ""}`}>{children}</span>
);

const ModuleRow = (
	{ row, busy, onAction }: {
		row: ManagerModuleRow;
		busy: boolean;
		onAction: (label: string, fn: () => Promise<unknown>) => void;
	},
) => {
	const deps = Object.entries(row.dependencies).map(([id, range]) => `${id}@${range}`).join(", ");
	return (
		<div className="spicetify-manager-module">
			<div className="spicetify-manager-module__head">
				<span className="spicetify-manager-module__name">{row.id}</span>
				<Badge>{row.version}</Badge>
				<Badge>{row.source}</Badge>
				{row.loaded && <Badge kind="ok">loaded</Badge>}
				{!row.loaded && !row.failed && <Badge>disabled</Badge>}
				{row.mixedIn && <Badge>mixins</Badge>}
				{row.failed !== undefined && <Badge kind="bad">failed</Badge>}
			</div>
			{deps && <div className="spicetify-manager-module__deps">needs {deps}</div>}
			{row.failed !== undefined && <div className="spicetify-manager-module__failure">{row.failed}</div>}
			<div className="spicetify-manager-module__actions">
				{row.loaded
					? (
						<>
							<button type="button" disabled={busy} onClick={() => onAction(`disable ${row.id}`, () => M().disable(row.id))}>
								Disable
							</button>
							<button type="button" disabled={busy} onClick={() => onAction(`reload ${row.id}`, () => M().reload(row.id))}>
								Reload
							</button>
						</>
					)
					: (
						<button type="button" disabled={busy} onClick={() => onAction(`enable ${row.id}`, () => M().enable(row.id))}>
							Enable
						</button>
					)}
				{row.source === "local" && (
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

	const copyDiagnostics = async () => {
		if (!navigator.clipboard) {
			setStatus("clipboard unavailable in this client");
			return;
		}
		const text = state.diagnostics
			.map((d) => `${new Date(d.ts).toISOString()} [${d.level}] ${d.message}`)
			.join("\n");
		try {
			await navigator.clipboard.writeText(text);
			setStatus("diagnostics copied");
		} catch (e) {
			setStatus(`copy failed: ${(e as Error).message}`);
		}
	};

	const q = filter.toLowerCase();
	const visible = state.modules.filter((m) => m.id.toLowerCase().includes(q));

	return (
		<div className="spicetify-manager-page">
			<header className="spicetify-manager-header">
				<div>
					<h1>Spicetify Manager</h1>
					<p className="spicetify-manager-subtitle">Runtime control for modules, boot health, and diagnostics</p>
				</div>
				<input
					className="spicetify-searchbar"
					type="text"
					placeholder="Filter modules…"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
				/>
			</header>

			<div className="spicetify-manager-status">{status}</div>

			<section>
				<h2>Environment</h2>
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
				{(() => {
					const advice = updateAdvice(state.spotifyVersion, support);
					return (
						<p className={`spicetify-manager-update spicetify-manager-update--${advice.kind}`}>
							{advice.message}
						</p>
					);
				})()}
				<p className="spicetify-manager-note">
					Installing or staging modules on disk happens outside the client — after changing staged modules, run{" "}
					<code>spicetify restore backup apply</code>.
				</p>
			</section>

			<section>
				<h2>Modules</h2>
				<div className="spicetify-manager-modules">
					{visible.map((row) => <ModuleRow key={row.id} row={row} busy={busy} onAction={onAction} />)}
					{!visible.length && (
						<div className="spicetify-manager-empty">
							{state.modules.length ? "No modules match the filter" : "No modules installed"}
						</div>
					)}
				</div>
			</section>

			<section>
				<div className="spicetify-manager-diag-head">
					<h2>Diagnostics</h2>
					<button type="button" onClick={() => void copyDiagnostics()} disabled={!state.diagnostics.length}>
						Copy all
					</button>
				</div>
				<div className="spicetify-manager-diag">
					{state.diagnostics.map((d, i) => (
						<div key={i} className={`spicetify-manager-diag__entry ${LEVEL_CLASS[d.level] ?? ""}`}>
							<span className="spicetify-manager-diag__time">
								{new Date(d.ts).toLocaleTimeString()}
							</span>
							<span>{d.message}</span>
						</div>
					))}
					{!state.diagnostics.length && <div className="spicetify-manager-empty">No diagnostics recorded</div>}
				</div>
			</section>
		</div>
	);
};
