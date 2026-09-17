import {
	React,
	type ManagedSpotifyCapability,
	type ManagedSpotifyAvailability,
	type ManagedSpotifySnapshot,
} from "/modules/stdlib/mod.ts";
import { managedJobMessage } from "./managedSpotifyState.ts";

type CheckState = { kind: "checking" } | { kind: "error"; message: string } | ManagedSpotifyAvailability;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const ManagedSpotifyUpdates = ({
	api,
	daemonAvailable,
	channel,
	installed,
}: {
	api: ManagedSpotifyCapability | undefined;
	daemonAvailable: boolean;
	channel: "stable" | "testing";
	installed: string | undefined;
}) => {
	const [snapshot, setSnapshot] = React.useState<ManagedSpotifySnapshot | null>(null);
	const [connection, setConnection] = React.useState<string | null>(null);
	const [available, setAvailable] = React.useState<CheckState>({ kind: "checking" });
	const [submitting, setSubmitting] = React.useState(false);
	const [actionError, setActionError] = React.useState<string | null>(null);
	const running = snapshot?.job.kind === "running";
	const terminalId = snapshot?.job.kind === "complete" || snapshot?.job.kind === "failed" ? snapshot.job.jobId : null;
	const installation = snapshot?.installation.kind === "managed" ? snapshot.installation : null;

	React.useEffect(() => {
		if (!api) return;
		let cancelled = false;
		let pending = false;
		const poll = async () => {
			if (pending) return;
			pending = true;
			try {
				const next = await api.status();
				if (!cancelled) {
					setSnapshot(next);
					setConnection(
						!next
							? "Apply a newer Spicetify build to manage package updates here."
							: next.installation.kind === "unavailable"
								? next.installation.message
								: null,
					);
				}
			} catch {
				if (!cancelled)
					setConnection("Waiting for the daemon. An accepted update continues when Spotify closes.");
			} finally {
				pending = false;
			}
		};
		void poll();
		const timer = setInterval(() => void poll(), 2000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [api]);

	React.useEffect(() => {
		if (!api || running) return;
		let cancelled = false;
		setAvailable({ kind: "checking" });
		void api.check().then(
			(result) => {
				if (!cancelled) setAvailable(result);
			},
			(error) => {
				if (!cancelled) setAvailable({ kind: "error", message: errorMessage(error) });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [api, running, terminalId]);

	const check = async () => {
		if (!api) return;
		setAvailable({ kind: "checking" });
		try {
			setAvailable(await api.check());
		} catch (error) {
			setAvailable({ kind: "error", message: errorMessage(error) });
		}
	};
	const update = async () => {
		if (
			!api ||
			!installation ||
			running ||
			submitting ||
			!globalThis.confirm(
				"Update Spotify and apply your customization? Spotify will restart when the replacement is ready.",
			)
		)
			return;
		setSubmitting(true);
		setActionError(null);
		try {
			const admission = await api.update();
			setSnapshot((previous) =>
				previous
					? { ...previous, job: { kind: "running", jobId: admission.jobId, phase: "checking" } }
					: previous,
			);
		} catch (error) {
			setActionError(errorMessage(error));
		} finally {
			setSubmitting(false);
		}
	};
	const message =
		available.kind === "checking"
			? "Checking the Linux package feed…"
			: available.kind === "error"
				? `Could not check for updates: ${available.message}`
				: available.kind === "current"
					? "Your managed Spotify installation is up to date."
					: available.kind === "unavailable"
						? `Spotify ${available.version} is available, but cannot be installed yet. ${available.message}`
						: `Spotify ${available.version} is ready to install.`;
	const jobMessage = snapshot ? managedJobMessage(snapshot.job) : null;
	return (
		<section>
			<div className="spicetify-manager-section-head">
				<h2>Updates</h2>
			</div>
			<div className="spicetify-manager-env">
				<span className="spicetify-manager-badge">
					installed {installation?.version ?? installed ?? "unknown"}
				</span>
				<span className="spicetify-manager-badge">Linux {installation?.channel ?? channel}</span>
				{"version" in available && (
					<span className="spicetify-manager-badge">available {available.version}</span>
				)}
			</div>
			<p className="spicetify-manager-note">
				Spicetify manages this Spotify installation. Package updates run only when you request them. Each update
				verifies compatibility and reapplies your customization before switching.
			</p>
			{api ? (
				<>
					<p className="spicetify-manager-update">{message}</p>
					{connection && (
						<p role="status" className="spicetify-manager-note">
							{connection}
						</p>
					)}
					{jobMessage && (
						<p role="status" className="spicetify-manager-update">
							{jobMessage}
						</p>
					)}
					{actionError && (
						<p role="alert" className="spicetify-manager-update">
							{actionError}
						</p>
					)}
					<div className="spicetify-manager-update-actions">
						<button
							type="button"
							disabled={running || submitting || available.kind === "checking"}
							onClick={() => void check()}
						>
							Check for updates
						</button>
						{available.kind === "ready" && (
							<button
								type="button"
								disabled={!installation || running || submitting || !!connection}
								onClick={() => void update()}
							>
								Update Spotify &amp; Apply
							</button>
						)}
					</div>
				</>
			) : (
				<p className="spicetify-manager-note">
					Run <code>spicetify spotify update</code> in a terminal.{" "}
					{daemonAvailable
						? "To enable this control, update Spicetify, run spicetify apply, and reopen Manager."
						: "Start the Spicetify daemon to update here."}
				</p>
			)}
		</section>
	);
};
