/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleRuntimeContext } from "../../mod.ts";

import { React } from "../expose/React.ts";
import { warn } from "../logger.ts";
import menu from "./menu.ts";
import { mountAdjacent } from "./mount.ts";
import { isNativeAnchor, type NativeAnchor, resolveNativeAnchor } from "./nativeAnchors.ts";
import navlink from "./navlink.tsx";
import panel from "./panel.ts";
import playbarButton, { PlaybarButton } from "./playbarButton.tsx";
import playbarWidget from "./playbarWidget.tsx";
import { Registry } from "./registry.ts";
import root from "./root.ts";
import route from "./route.ts";
import settingsRow from "./settingsRow.tsx";
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
	settingsRow,
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
	/**
	 * Place the button next to one of the client's own buttons instead of in the
	 * module-button group. `anchor` is a stable stdlib-owned name (e.g.
	 * "playbar:queue"); if it can't be resolved on this client the button falls
	 * back to ordinary `order` placement, so it is never hidden. `side` defaults
	 * to "after".
	 */
	near?: { anchor: NativeAnchor; side?: "before" | "after" };
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
	// Cleanups for things not held in the registry ledger (e.g. near-anchored
	// buttons, which mount their own host). Run on dispose so nothing leaks
	// when the module unloads.
	private disposers = new Set<() => void>();

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

		const inGroup = (): ButtonHandle => {
			this.register(key, element);
			return { remove: () => this.unregister(key, element) };
		};

		if (!options.near) return inGroup();
		const { anchor, side = "after" } = options.near;
		if (!isNativeAnchor(anchor)) {
			warn(`[stdlib] unknown native anchor "${anchor}"; placing "${options.label}" with order instead`);
			return inGroup();
		}

		// Try to sit next to the named native button; if it never appears, fall
		// back to the module-button group so the button is never lost.
		let fellBackHandle: ButtonHandle | undefined;
		const adjacent = mountAdjacent({
			className: "spicetify-near-button",
			element,
			findTarget: () => resolveNativeAnchor(anchor),
			side,
			giveUpMs: 5000,
			onGiveUp: () => {
				fellBackHandle ??= inGroup();
			},
		});
		// Tracked so module unload (dispose) tears the near button down too; the
		// near path never touches the registry ledger, so it needs its own hook.
		const cleanup = () => {
			adjacent.remove();
			fellBackHandle?.remove();
		};
		this.disposers.add(cleanup);
		return {
			remove: () => {
				this.disposers.delete(cleanup);
				cleanup();
			},
		};
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
		for (const dispose of this.disposers) dispose();
		this.disposers.clear();
	}
}

export const createRegistrar = (ctx: ModuleRuntimeContext) => {
	const registrar = new Registrar(ctx.identifier);
	ctx.defer(() => {
		registrar.dispose();
	});
	return registrar;
};
