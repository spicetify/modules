/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "/modules/stdlib/src/expose/React.ts";
import { Platform } from "/modules/stdlib/src/expose/Platform.ts";
import { deriveManagerState, show, showBool } from "./state.ts";

export const MANAGER_ROUTE = "/bespoke/manager";

// The settings anchor keeps one React root alive across visits, so the
// section must refresh itself; a light poll keeps values honest while the
// settings page is open (and is idle-cheap while the root sits detached).
export const ManagerSection = () => {
	const [state, setState] = React.useState(deriveManagerState);
	React.useEffect(() => {
		const timer = setInterval(() => setState(deriveManagerState()), 2000);
		return () => clearInterval(timer);
	}, []);

	const rows: Array<[string, string]> = [
		["Spotify version", show(state.spotifyVersion)],
		["Classmap", show(state.classmapKey)],
		["Spicetify CLI", show(state.cliVersion)],
		["Spotify updates blocked", showBool(state.updatesBlocked)],
		["Source transforms", state.transformsEnabled ? "experimental (on)" : "off"],
		[
			"Modules",
			`${state.loadedCount} loaded${state.failedCount ? `, ${state.failedCount} failed` : ""} of ${state.modules.length}`,
		],
	];

	return (
		<div className={`${MAP.settings.section.container} spicetify-manager-section`}>
			<div className={MAP.settings.header.container}>
				<h2 className="encore-text encore-text-title-small">Spicetify</h2>
			</div>
			{rows.map(([label, value]) => (
				<div key={label} className="spicetify-manager-row">
					<span className="spicetify-manager-row__label">{label}</span>
					<span className="spicetify-manager-row__value">{value}</span>
				</div>
			))}
			<div className="spicetify-manager-row">
				<button
					type="button"
					className="spicetify-manager-cta"
					onClick={() => Platform.getHistory().push(MANAGER_ROUTE)}
				>
					Open Spicetify Manager
				</button>
			</div>
		</div>
	);
};
