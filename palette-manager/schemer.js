/* Copyright (C) 2024 harbassan, and Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */ import { Palette, PaletteManager } from "./palette.js";
class Schemer {
    mod;
    constructor(mod){
        this.mod = mod;
    }
    register(name, colors) {
        const palette = new Palette(`${this.mod.getModuleIdentifier()}/${name}`, name, colors);
        PaletteManager.INSTANCE.staticPalettes.add(palette);
        if (PaletteManager.INSTANCE.isCurrent(palette)) {
            PaletteManager.INSTANCE.setCurrent(palette);
        }
        return;
    }
}
export function createSchemer(mod) {
    return new Schemer(mod);
}
