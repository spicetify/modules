import { Palette, PaletteManager } from "./palette.js";
class Schemer {
    mod;
    constructor(mod){
        this.mod = mod;
    }
    register(name, colors) {
        const palette = new Palette(`${this.mod.getModuleIdentifier()}/${name}`, name, colors);
        PaletteManager.INSTANCE.staticPalettes.add(palette);
        if (palette.isCurrent()) {
            PaletteManager.INSTANCE.setCurrent(palette);
        }
        return;
    }
}
export function createSchemer(mod) {
    return new Schemer(mod);
}
