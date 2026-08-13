/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { Registry } from "./registry.ts";
import route from "./route.ts";

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
		{ className: "spicetify-settings-page" },
		React.createElement(
			"header",
			{ className: "spicetify-settings-page__header" },
			React.createElement("h1", null, "Spicetify Settings"),
			React.createElement("p", null, "Configure your installed modules and open Spicetify management tools."),
		),
		React.createElement(
			"div",
			{ className: "spicetify-settings-page__sections" },
			sections.map((section, index) => React.createElement(React.Fragment, { key: index }, section)),
		),
		React.createElement(
			"div",
			{ className: "spicetify-settings-page__actions" },
			actions.map((action, index) => React.createElement(React.Fragment, { key: index }, action)),
		),
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
