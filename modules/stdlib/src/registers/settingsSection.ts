/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mixin.ts";
import { mountRegistryAnchor } from "./mount.ts";
import { Registry } from "./registry.ts";

const registry = new (class extends Registry<React.ReactNode> {
	override add(value: React.ReactNode): this {
		refresh?.();
		return super.add(value);
	}

	override delete(value: React.ReactNode): boolean {
		refresh?.();
		return super.delete(value);
	}
})();
export default registry;

let refresh: (() => void) | undefined;

declare global {
	var __renderSettingSections: any;
}

globalThis.__renderSettingSections = () => registry.all();
transformer(
	(emit) => (str) => {
		emit();

		str = str.replace(
			/(\(0,[a-zA-Z_\$][\w\$]*\.jsx\)\([a-zA-Z_\$][\w\$]*,{settings:[a-zA-Z_\$][\w\$]*,setValue:[a-zA-Z_\$][\w\$]*}\))]/,
			"$1,...__renderSettingSections()]",
		);

		return str;
	},
	{
		wait: false,
		glob: /^\/xpui-routes-desktop-settings\.js/,
	},
);

// The settings container only exists while the settings route is open; the
// anchor keeper re-places the host every time it reappears.
mountRegistryAnchor({
	className: "spicetify-settings-sections",
	registry,
	setRefresh: (cb) => {
		refresh = cb;
	},
	findSlot: () => {
		const container = document.querySelector(".x-settings-container");
		return container ? { parent: container } : null;
	},
});
