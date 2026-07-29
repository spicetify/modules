/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleRuntimeContext } from "../../mod.ts";

import { React } from "../expose/React.ts";
import menu from "./menu.ts";
import navlink from "./navlink.tsx";
import panel from "./panel.ts";
import playbarButton, { PlaybarButton } from "./playbarButton.tsx";
import playbarWidget from "./playbarWidget.tsx";
import { Registry } from "./registry.ts";
import root from "./root.ts";
import route from "./route.ts";
import settingsSection from "./settingsSection.ts";
import topbarLeftButton, { TopbarLeftButton } from "./topbarLeftButton.tsx";
import topbarRightButton, { TopbarRightButton } from "./topbarRightButton.tsx";
const [rootChild, rootProvider] = root;
const registers = {
	menu,
	navlink,
	panel,
	playbarButton,
	playbarWidget,
	rootChild,
	rootProvider,
	route,
	settingsSection,
	topbarLeftButton,
	topbarRightButton,
} satisfies Record<string, Registry<any>>;
type Registers = typeof registers;

// ---- placeButton: one ergonomic, position-controllable way to add a button ----
// Instead of picking the right register key and hand-building the matching
// component (easy to mismatch, no ordering), a module names a location and
// passes the button's props in one call. `order` controls position within the
// group of module buttons in that slot (lower renders earlier).

/** Where a module button can live. */
export type ButtonLocation = "topbar-left" | "topbar-right" | "playbar";

export interface PlaceButtonOptions {
	/** Tooltip + accessible label. */
	label: string;
	/** Inner SVG markup drawn on the stdlib 16-grid. */
	icon?: string;
	onClick: () => void;
	disabled?: boolean;
	/** Position within this slot's module buttons; lower renders earlier. Default 0. */
	order?: number;
	/** Playbar only: render the active indicator. Ignored in the top bar. */
	isActive?: boolean;
}

export interface ButtonHandle {
	/** Remove the button now. It is also removed automatically when the module unloads. */
	remove(): void;
}

const BUTTON_SLOTS = {
	"topbar-left": ["topbarLeftButton", TopbarLeftButton],
	"topbar-right": ["topbarRightButton", TopbarRightButton],
	playbar: ["playbarButton", PlaybarButton],
} as const satisfies Record<ButtonLocation, [keyof Registers, React.FC<any>]>;

export class Registrar {
	constructor(public id: string) {}

	private ledger = new Map<any, keyof Registers>();

	/**
	 * Place a button in a known client location without touching register keys
	 * or building the component yourself. Returns a handle to remove it early;
	 * otherwise it is cleaned up when the module unloads.
	 */
	placeButton(location: ButtonLocation, options: PlaceButtonOptions): ButtonHandle {
		const slot = BUTTON_SLOTS[location];
		if (!slot) throw new Error(`[stdlib] unknown button location: ${location}`);
		const [key, Component] = slot;
		const element = React.createElement(Component as React.FC<PlaceButtonOptions>, { order: 0, ...options });
		this.register(key, element);
		return { remove: () => this.unregister(key, element) };
	}

	register<R extends keyof Registers>(type: R, ...args: Parameters<Registers[R]["add"]>) {
		this.ledger.set(args[0], type);
		// @ts-ignore
		registers[type].add(...args);
	}

	// Routes are registered as elements with a string "route" tag; this
	// hides that incantation. Returns the item for manual unregister.
	registerRoute(path: string, element: React.ReactNode): React.ReactNode {
		const item = React.createElement("route", { path, element });
		this.register("route", item);
		return item;
	}

	unregister<R extends keyof Registers>(type: R, ...args: Parameters<Registers[R]["delete"]>) {
		this.ledger.delete(args[0]);
		// @ts-ignore
		registers[type].delete(...args);
	}

	dispose() {
		for (const [item, type] of this.ledger.entries()) this.unregister(type, item);
		this.ledger.clear();
	}
}

export const createRegistrar = (ctx: ModuleRuntimeContext) => {
	const registrar = new Registrar(ctx.identifier);
	ctx.defer(() => {
		registrar.dispose();
	});
	return registrar;
};
