/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { SETTINGS_HEADER_CLASS, SETTINGS_HEADER_CONTAINER_CLASS } from "../../lib/primitives-classes.ts";
import { Registry } from "./registry.ts";
import route from "./route.ts";
import { CorsProxySettings } from "../settings/corsProxy.tsx";

export const SPICETIFY_SETTINGS_ROUTE = "/bespoke/settings";

const listeners = new Set<() => void>();
const notify = () => {
	for (const listener of listeners) listener();
};

class SettingsRegistry extends Registry<React.ReactNode> {
	override add(value: React.ReactNode): this {
		super.add(value);
		notify();
		return this;
	}

	override delete(value: React.ReactNode): boolean {
		const deleted = super.delete(value);
		if (deleted) notify();
		return deleted;
	}
}

const registry = new SettingsRegistry();
export default registry;

// Navigation and management actions belong after every module's controls.
// Keeping them in a separate register makes the ordering structural instead
// of dependent on module load order.
export const settingsAction = new SettingsRegistry();

const SpicetifySettingsPage = () => {
	const [, forceRender] = React.useReducer((value: number) => value + 1, 0);
	React.useEffect(() => {
		listeners.add(forceRender);
		return () => void listeners.delete(forceRender);
	}, []);

	const sections = registry.all();
	const actions = settingsAction.all();
	return React.createElement(
		"main",
		{ className: "spicetify-settings-page x-settings-container" },
		React.createElement(
			"div",
			{ className: SETTINGS_HEADER_CONTAINER_CLASS },
			React.createElement(
				"h1",
				{ className: SETTINGS_HEADER_CLASS, style: { paddingBlockEnd: "16px" } },
				"Spicetify Settings",
			),
		),
		...sections.map((section, index) => React.createElement(React.Fragment, { key: `section-${index}` }, section)),
		React.createElement(CorsProxySettings, { key: "cors-proxy" }),
		...actions.map((action, index) => React.createElement(React.Fragment, { key: `action-${index}` }, action)),
	);
};

// The page belongs to stdlib rather than Manager so settings remain available
// when the optional management UI fails or is disabled.
if (typeof document !== "undefined") {
	void CHUNKS.xpui.promise.then(() => {
		route.add(
			React.createElement("route", {
				path: SPICETIFY_SETTINGS_ROUTE,
				element: React.createElement(SpicetifySettingsPage),
			}),
		);
	});
}
