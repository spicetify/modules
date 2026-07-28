/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The client still exposes the classic Spicetify.Playbar.Button/Widget, but
// they no longer mount in the restructured playbar (they construct a DOM node
// that is never inserted). Every other v2 helper (Menu, ContextMenu, Topbar,
// Keyboard, PopupModal, ...) still works, so this is the one gap. We re-back
// Button/Widget with the v3 playbarButton register so classic extensions and
// muscle memory keep working, and the typed API never hands you a dead helper.

import { React } from "./expose/React.ts";
import playbarButtons, { PlaybarButton } from "./registers/playbarButton.tsx";

// The register feeds `icon` to createIconComponent, which supplies its own
// <svg> wrapper. Classic icons are full <svg>...</svg> strings, so hand it the
// inner markup; already-inner markup passes through untouched.
const innerSvg = (icon: string): string => {
	const match = /<svg[^>]*>([\s\S]*)<\/svg>/i.exec(icon);
	return match ? match[1] : icon;
};

class PlaybarCompat {
	onClick: (self: PlaybarCompat) => void;
	private _label: string;
	private _icon: string;
	private _active: boolean;
	private _disabled: boolean;
	private node: React.ReactNode | null = null;
	private readonly refreshers = new Set<() => void>();

	constructor(
		label: string,
		icon: string,
		onClick: (self: PlaybarCompat) => void = () => {},
		disabled = false,
		active = false,
		registerOnCreate = true,
	) {
		this._label = label;
		this._icon = icon;
		this.onClick = onClick;
		this._disabled = disabled;
		this._active = active;
		if (registerOnCreate) this.register();
	}

	private refresh() {
		for (const f of this.refreshers) f();
	}

	// Mutating any display field re-renders the mounted button, matching the
	// classic API where `widget.active = true` / `widget.label = "..."` update live.
	get label() {
		return this._label;
	}
	set label(v) {
		this._label = v;
		this.refresh();
	}
	get icon() {
		return this._icon;
	}
	set icon(v) {
		this._icon = v;
		this.refresh();
	}
	get active() {
		return this._active;
	}
	set active(v) {
		this._active = v;
		this.refresh();
	}
	get disabled() {
		return this._disabled;
	}
	set disabled(v) {
		this._disabled = v;
		this.refresh();
	}
	// No standalone DOM node in the register model; classic code rarely touches these.
	get element(): HTMLButtonElement | null {
		return null;
	}
	get tippy(): unknown {
		return null;
	}

	register() {
		if (this.node) return;
		const self = this;
		const Compat = () => {
			const [, force] = React.useReducer((n: number) => n + 1, 0);
			React.useEffect(() => {
				self.refreshers.add(force);
				return () => {
					self.refreshers.delete(force);
				};
			}, []);
			return (
				<PlaybarButton
					label={self._label}
					icon={innerSvg(self._icon)}
					isActive={self._active}
					disabled={self._disabled}
					onClick={() => self.onClick(self)}
				/>
			);
		};
		this.node = <Compat />;
		playbarButtons.add(this.node);
	}

	deregister() {
		if (!this.node) return;
		playbarButtons.delete(this.node);
		this.node = null;
	}
}

// Replace the client's dead Button/Widget with the register-backed shim.
// Returns a teardown that restores the originals.
export function installPlaybarCompat(): () => void {
	const S = (globalThis as { Spicetify?: { Playbar?: Record<string, unknown> } }).Spicetify;
	if (!S?.Playbar) return () => {};
	const original = { Button: S.Playbar.Button, Widget: S.Playbar.Widget };
	S.Playbar.Button = PlaybarCompat;
	S.Playbar.Widget = PlaybarCompat;
	return () => {
		if (!S.Playbar) return;
		S.Playbar.Button = original.Button;
		S.Playbar.Widget = original.Widget;
	};
}
