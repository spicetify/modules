/* Copyright (C) 2024 harbassan, and Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Palette, PaletteManager } from "./palette.ts";
import { Module } from "/hooks/index.ts";
import type { Color } from "/modules/official/stdlib/src/webpack/misc.ts";

class Schemer {
	constructor(private mod: Module) {}

	register(name: string, colors: Record<string, Color>) {
		const palette = new Palette(`${this.mod.getModuleIdentifier()}/${name}`, name, colors);
		PaletteManager.INSTANCE.staticPalettes.add(palette);
		if (PaletteManager.INSTANCE.isCurrent(palette)) {
			PaletteManager.INSTANCE.setCurrent(palette);
		}
		return;
	}
}

export function createSchemer(mod: Module) {
	return new Schemer(mod);
}
