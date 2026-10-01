/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "/modules/stdlib/mod.ts";

import { type AutoUpdateApi, type DaemonInfo, pendingCliUpdate } from "./autoUpdate.ts";

type SelfUpdateDaemon = AutoUpdateApi & { apply(): Promise<unknown> };

// Spicetify's own updates: the release installed since the last apply, and the
// automatic-update setting. Shared by the regular and the managed-Spotify
// update panels, so every platform shows it.
export const SpicetifySelfUpdate = ({
	daemon,
	daemonInfo,
	setDaemonInfo,
	cliVersion,
	busy,
	onAction,
}: {
	daemon: SelfUpdateDaemon | null;
	daemonInfo: DaemonInfo | null;
	setDaemonInfo: (update: (prev: DaemonInfo | null) => DaemonInfo | null) => void;
	cliVersion: string | undefined;
	busy: boolean;
	onAction: (label: string, fn: () => Promise<unknown>) => void;
}) => {
	const pending = pendingCliUpdate(daemonInfo, cliVersion);
	const canToggle = !!daemon?.setAutoUpdate && typeof daemonInfo?.autoUpdate === "boolean";
	if (!pending && !canToggle) return null;
	return (
		<>
			{pending && (
				<p className="spicetify-manager-update spicetify-manager-update--ready">
					{`Spicetify ${pending} is installed. Apply to use it in Spotify.`}
				</p>
			)}
			{pending && daemon && (
				<div className="spicetify-manager-update-actions">
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							if (!globalThis.confirm("apply: Spotify will restart. Continue?")) return;
							onAction("apply", () => daemon.apply());
						}}
					>
						apply
					</button>
				</div>
			)}
			{canToggle && (
				<label className="spicetify-manager-toggle">
					<input
						type="checkbox"
						checked={daemonInfo!.autoUpdate!}
						disabled={busy}
						onChange={(e) => {
							const on = e.currentTarget.checked;
							onAction(`automatic updates ${on ? "on" : "off"}`, async () => {
								await daemon!.setAutoUpdate!(on);
								setDaemonInfo((prev) => (prev ? { ...prev, autoUpdate: on } : prev));
							});
						}}
					/>
					Install Spicetify updates automatically
				</label>
			)}
			{daemonInfo?.autoUpdate && daemonInfo.autoUpdateActive === false && (
				<p className="spicetify-manager-note">
					This copy of Spicetify isn't in the installer's folder, so it doesn't update itself. Update it the
					way you installed it.
				</p>
			)}
		</>
	);
};
