/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The stable module-facing boundary around the wrapper runtime.
 *
 * Keep ambient `Spicetify` access in this adapter. Modules import `client`
 * instead, which gives stdlib one place to replace or harden a capability as
 * Spotify changes. Getters are intentionally lazy: some surfaces, notably the
 * modular loader API, are attached after the client has started loading
 * modules.
 */

import type { ModalOptions } from "../lib/modal.tsx";

type SpicetifyRuntime = typeof Spicetify;

export type PlayerState = Spicetify.PlayerState;

export interface PopupModalCompatibility {
	display(options: ModalOptions): void;
	hide(): void;
}

export interface DaemonCapabilities {
	available(): Promise<boolean>;
	apply(): Promise<unknown>;
	blockUpdates(): Promise<unknown>;
	unblockUpdates(): Promise<unknown>;
}

export interface SnackbarCapabilities {
	enqueueSnackbar(message: string, options?: { variant?: string }): unknown;
}

export interface ClientCapabilities {
	readonly player: typeof Spicetify.Player;
	readonly platform: typeof Spicetify.Platform;
	readonly storage: typeof Spicetify.LocalStorage;
	readonly uri: typeof Spicetify.URI;
	readonly cosmos: typeof Spicetify.CosmosAsync;
	readonly corsProxy: typeof Spicetify.CORSProxy;
	readonly graphQL: typeof Spicetify.GraphQL;
	readonly locale: typeof Spicetify.Locale;
	readonly icons: typeof Spicetify.SVGIcons;
	readonly keyboard: typeof Spicetify.Keyboard;
	readonly mousetrap: typeof Spicetify.Mousetrap;
	readonly contextMenu: typeof Spicetify.ContextMenu;
	/** @deprecated Import displayModal and hideModal from /modules/stdlib/mod.ts. */
	readonly popupModal: PopupModalCompatibility;
	readonly config: typeof Spicetify.Config;
	readonly modules: typeof Spicetify.Modules;
	/** V3 manifest version, with the legacy wrapper config as a fallback. */
	readonly spicetifyVersion: string | undefined;
	readonly daemon: DaemonCapabilities | undefined;
	readonly snackbar: SnackbarCapabilities | undefined;
	readonly react: typeof Spicetify.React;
	readonly reactDOM: typeof Spicetify.ReactDOM;
	readonly tippy: typeof Spicetify.Tippy;
	readonly tippyProps: typeof Spicetify.TippyProps;
	readonly playbar: typeof Spicetify.Playbar;
	readonly notify: typeof Spicetify.showNotification;
}

const runtime = (): SpicetifyRuntime => {
	const value = (globalThis as unknown as { Spicetify?: SpicetifyRuntime }).Spicetify;
	if (!value) throw new Error("Spicetify client runtime is unavailable");
	return value;
};

const nonEmptyVersion = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() ? value : undefined;

let modalRequestGeneration = 0;
const reportModalFailure = (error: unknown) => console.error("[stdlib] failed to load the owned modal:", error);
const popupModalCompatibility: PopupModalCompatibility = {
	display(options) {
		const generation = ++modalRequestGeneration;
		void import("../lib/modal.tsx")
			.then(({ display }) => {
				if (generation === modalRequestGeneration) display(options);
			})
			.catch(reportModalFailure);
	},
	hide() {
		++modalRequestGeneration;
		void import("../lib/modal.tsx").then(({ hide }) => hide()).catch(reportModalFailure);
	},
};

export const client: ClientCapabilities = {
	get player() {
		return runtime().Player;
	},
	get platform() {
		return runtime().Platform;
	},
	get storage() {
		return runtime().LocalStorage;
	},
	get uri() {
		return runtime().URI;
	},
	get cosmos() {
		return runtime().CosmosAsync;
	},
	get corsProxy() {
		return runtime().CORSProxy;
	},
	get graphQL() {
		return runtime().GraphQL;
	},
	get locale() {
		return runtime().Locale;
	},
	get icons() {
		return runtime().SVGIcons;
	},
	get keyboard() {
		return runtime().Keyboard;
	},
	get mousetrap() {
		return runtime().Mousetrap;
	},
	get contextMenu() {
		return runtime().ContextMenu;
	},
	get popupModal() {
		return popupModalCompatibility;
	},
	get config() {
		return runtime().Config;
	},
	get modules() {
		return runtime().Modules;
	},
	get spicetifyVersion() {
		const current = runtime() as unknown as {
			Modules?: {
				manifest?: { cliVersion?: unknown };
				registry?: { manifest?: { cliVersion?: unknown } };
			};
			Config?: { version?: unknown };
		};
		return (
			nonEmptyVersion(current.Modules?.manifest?.cliVersion) ??
			nonEmptyVersion(current.Modules?.registry?.manifest?.cliVersion) ??
			nonEmptyVersion(current.Config?.version)
		);
	},
	get daemon() {
		return (runtime() as unknown as { Daemon?: DaemonCapabilities }).Daemon;
	},
	get snackbar() {
		return (runtime() as unknown as { Snackbar?: SnackbarCapabilities }).Snackbar;
	},
	get react() {
		return runtime().React;
	},
	get reactDOM() {
		return runtime().ReactDOM;
	},
	get tippy() {
		return runtime().Tippy;
	},
	get tippyProps() {
		return runtime().TippyProps;
	},
	get playbar() {
		return runtime().Playbar;
	},
	get notify() {
		return runtime().showNotification;
	},
};
