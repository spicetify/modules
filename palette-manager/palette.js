/* Copyright (C) 2024 harbassan, and Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */ import { storage } from "./index.js";
import { Color } from "/modules/official/stdlib/src/webpack/misc.js";
// TODO: edit these keys
const def_fields = {
    text: Color.fromHex("#ffffff"),
    subtext: Color.fromHex("#a7a7a7"),
    base: Color.fromHex("#000000"),
    main: Color.fromHex("#121212"),
    main_elevated: Color.fromHex("#242424"),
    highlight: Color.fromHex("#1a1a1a"),
    highlight_elevated: Color.fromHex("#2a2a2a"),
    card: Color.fromHex("#292929"),
    button: Color.fromHex("#1ed760"),
    button_active: Color.fromHex("#1ed760"),
    notification: Color.fromHex("#3d91f4"),
    tab: Color.fromHex("#b3b3b3"),
    tab_active: Color.fromHex("#ffffff"),
    playbar: Color.fromHex("#ffffff"),
    playbar_active: Color.fromHex("#1ed760")
};
export class Palette {
    id;
    name;
    colors;
    isStatic;
    constructor(id, name, colors, isStatic = true){
        this.id = id;
        this.name = name;
        this.colors = colors;
        this.isStatic = isStatic;
    }
    overwrite(map) {
        if (this.isStatic) {
            return false;
        }
        this.colors = map;
        return true;
    }
    toCSS() {
        function formatKey(key) {
            return `--spice-${key.replaceAll("_", "-")}`;
        }
        function formatValue(value) {
            return value.toCSS(Color.Format.HEX);
        }
        return Object.entries(this.colors).map(([k, v])=>`${formatKey(k)}: ${formatValue(v)};`).join(" ");
    }
    toJSON() {
        const colors = {};
        for (const [k, v] of Object.entries(this.colors)){
            colors[k] = JSON.stringify(v);
        }
        return {
            id: this.id,
            name: this.name,
            colors
        };
    }
    static fromJSON(json) {
        const colors = {};
        for (const [k, v] of Object.entries(json.colors)){
            colors[k] = Color.parse(v);
        }
        return new Palette(json.id, json.name, colors, false);
    }
}
const defaultPalette = new Palette("official/palette-manager/default", "Spotify • default", def_fields);
export class PaletteManager {
    static INSTANCE = new PaletteManager();
    staticPalettes = new Set([
        defaultPalette
    ]);
    userPalettes = new Set;
    palette;
    stylesheet = document.createElement("style");
    constructor(){
        document.head.appendChild(this.stylesheet);
        const paletteStr = storage.getItem("palette");
        const palette = paletteStr ? Palette.fromJSON(JSON.parse(paletteStr)) : this.getDefault();
        this.setCurrent(palette);
        this.initUserPalettes();
    }
    initUserPalettes() {
        const userPalettesJSON = JSON.parse(storage.getItem("user_palettes") || "[]");
        const userPalettes = userPalettesJSON.map((json)=>Palette.fromJSON(json));
        for (const palette of userPalettes){
            this.userPalettes.add(palette);
            if (this.isCurrent(palette)) {
                this.setCurrent(palette);
            }
        }
    }
    getDefault() {
        return this.staticPalettes.keys().next().value;
    }
    getPalettes() {
        return [
            ...this.userPalettes,
            ...this.staticPalettes
        ];
    }
    save() {
        storage.setItem("user_palettes", JSON.stringify(Array.from(this.userPalettes)));
    }
    getCurrent() {
        return this.palette;
    }
    setCurrent(palette) {
        this.palette = palette;
        this.writeCurrent();
        return palette;
    }
    writeCurrent() {
        this.stylesheet.innerHTML = `.encore-dark-theme { ${this.palette.toCSS()} }`;
        this.saveCurrent();
    }
    saveCurrent() {
        storage.setItem("palette", JSON.stringify(this.palette));
    }
    addUserPalette(palette) {
        this.userPalettes.add(palette);
        this.save();
    }
    deleteUserPalette(palette) {
        this.userPalettes.delete(palette);
        if (this.isCurrent(palette)) {
            this.setCurrent(this.getDefault());
        }
        this.save();
    }
    renameUserPalette(palette, name) {
        palette.name = name;
        if (this.isCurrent(palette)) {
            this.saveCurrent();
        }
        this.save();
    }
    isCurrent(palette) {
        return palette.id === this.getCurrent().id;
    }
}
