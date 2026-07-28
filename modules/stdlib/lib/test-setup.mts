/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// DOM test harness: installs happy-dom's document/window and the element
// and event constructors onto globalThis so DOM-producing code can be
// unit-tested under `node --test` with no running browser. Import this
// FIRST in any *.test.mts that builds DOM. Named .mts so the stdlib
// tree-module build (which only bundles .ts/.tsx) never ships it.

import { Window } from "happy-dom";

const win = new Window({ url: "https://xpui.app.spotify.com" });

const globals = [
	"document",
	"window",
	"Node",
	"Element",
	"HTMLElement",
	"HTMLButtonElement",
	"HTMLSelectElement",
	"HTMLOptionElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"HTMLSpanElement",
	"HTMLDivElement",
	"Event",
	"CustomEvent",
	"MouseEvent",
	"InputEvent",
	"KeyboardEvent",
] as const;

for (const key of globals) {
	// window itself maps to the Window instance; everything else is a
	// property on it (document, constructors, event classes).
	(globalThis as Record<string, unknown>)[key] =
		key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
}
