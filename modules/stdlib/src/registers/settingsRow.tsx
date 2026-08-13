/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { SettingsSection } from "../../lib/primitives.tsx";
import { Registry } from "./registry.ts";
import settingsSection from "./settingsSection.ts";

// Rows from every module, rendered together under one "General" section on
// the standalone Spicetify Settings page. A module with a single setting
// registers a row here instead of claiming a whole section (or a menu slot) of
// its own; SettingsToggleRow (lib/primitives.tsx) is the one-boolean case.
const listeners = new Set<() => void>();

const registry = new (class extends Registry<React.ReactNode> {
	override add(value: React.ReactNode): this {
		super.add(value);
		for (const l of listeners) l();
		return this;
	}

	override delete(value: React.ReactNode): boolean {
		const deleted = super.delete(value);
		for (const l of listeners) l();
		return deleted;
	}
})();
export default registry;

const SpicetifyGroup = () => {
	const [, force] = React.useReducer((n: number) => n + 1, 0);
	React.useEffect(() => {
		listeners.add(force);
		return () => void listeners.delete(force);
	}, []);
	const rows = registry.all();
	if (rows.length === 0) return null;
	return (
		<SettingsSection title="General">
			{rows.map((row, i) => (
				<React.Fragment key={i}>{row}</React.Fragment>
			))}
		</SettingsSection>
	);
};

// The group element must not be created at import time: this module is also
// evaluated during the mixin phase, before the client React instance exists,
// and the jsx runtime would call into a React that is not there yet.
if (typeof document !== "undefined") {
	void CHUNKS.xpui.promise.then(() => {
		settingsSection.add(React.createElement(SpicetifyGroup));
	});
}
