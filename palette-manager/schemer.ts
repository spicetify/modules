import { Palette, PaletteManager } from "./palette.ts";
import { ModuleInstance } from "/hooks/module.ts";
import { Color } from "/modules/official/stdlib/src/webpack/misc.ts";

class Schemer {
   constructor(private mod: ModuleInstance) { }

   register(name: string, colors: Record<string, Color>) {
      const palette = new Palette(`${this.mod.getModuleIdentifier()}/${name}`, name, colors);
      PaletteManager.INSTANCE.staticPalettes.add(palette);
      if (palette.isCurrent()) {
         PaletteManager.INSTANCE.setCurrent(palette);
      }
      return;
   }
}

export function createSchemer(mod: ModuleInstance) {
   return new Schemer(mod);
}
