/*
 * Copyright (C) 2026 Spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

function source(value: unknown): string {
	return typeof value === "function" ? Function.prototype.toString.call(value) : "";
}

function hasPlaylistMenuActions(text: string): boolean {
	return (
		text.includes("contextmenu.share.copy-playlist-link") &&
		text.includes("canView") &&
		text.includes("permissions")
	);
}

export function isPlaylistMenuFactory(value: unknown): boolean {
	return hasPlaylistMenuActions(source(value));
}

function isMenuComponent(value: unknown): boolean {
	let render = value;
	if (typeof render === "object" && render !== null && "$$typeof" in render) {
		if (render.$$typeof === Symbol.for("react.memo") && "type" in render) render = render.type;
		else if (render.$$typeof === Symbol.for("react.forward_ref") && "render" in render) render = render.render;
	}
	const text = source(render);
	if (/^async\b/.test(text)) return false;
	if (hasPlaylistMenuActions(text)) return /\b(?:jsx|jsxs|createElement)\s*\)?\s*\(/.test(text);
	// Current clients export a thin JSX wrapper around the unexported memo.
	// Match the whole wrapper, not JSX nested inside a page root.
	return /^\(?([$\w]+)\)?=>\(0,[$\w]+\.jsx\)\([$\w]+,\{\.\.\.\1\}\)$/.test(text.replace(/\s/g, ""));
}

/** Match the menu factory, then its renderable export; never a playlist data mapper. */
export function findPlaylistMenu(
	modules: Iterable<readonly [PropertyKey, unknown]>,
	requireModule: (id: PropertyKey) => unknown,
): unknown {
	const components = new Set<unknown>();
	try {
		for (const [id, factory] of modules) {
			if (!isPlaylistMenuFactory(factory)) continue;
			const exports = requireModule(id);
			if (typeof exports !== "object" || exports === null) continue;
			for (const value of Object.values(exports)) if (isMenuComponent(value)) components.add(value);
		}
	} catch {
		// An unreadable client export leaves uniqueness unproven; degrade only this menu.
		return undefined;
	}
	return components.size === 1 ? components.values().next().value : undefined;
}
