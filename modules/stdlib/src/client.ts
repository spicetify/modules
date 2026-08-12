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

type SpicetifyRuntime = typeof Spicetify;

export type PlayerState = Spicetify.PlayerState;

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
	readonly popupModal: typeof Spicetify.PopupModal;
	readonly config: typeof Spicetify.Config;
	readonly modules: typeof Spicetify.Modules;
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
		return runtime().PopupModal;
	},
	get config() {
		return runtime().Config;
	},
	get modules() {
		return runtime().Modules;
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
