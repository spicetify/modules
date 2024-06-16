/* Copyright (C) 2024 harbassan, and Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { storage } from "./index.tsx";
import { Color } from "/modules/official/stdlib/src/webpack/misc.ts";

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
	playbar_active: Color.fromHex("#1ed760"),
};

type PaletteData = { id: string, name: string, colors: Record<string, string>; };
export class Palette {
	constructor(public id: string, public name: string, public colors: Record<string, Color>, public isStatic = true) { }

	overwrite(map: Record<string, Color>) {
		if (this.isStatic) {
			return false;
		}
		this.colors = map;
		return true;
	}

	toCSS() {
		function formatKey(key: string) {
			return `--spice-${key.replaceAll("_", "-")}`;
		}

		function formatValue(value: Color) {
			return value.toCSS(Color.Format.HEX);
		}

		return Object.entries(this.colors).map(([k, v]) => `${formatKey(k)}: ${formatValue(v)};`).join(" ");
	}

	toJSON(): PaletteData {
		const colors: Record<string, string> = {};
		for (const [k, v] of Object.entries(this.colors)) {
			colors[k] = JSON.stringify(v);
		}
		return { id: this.id, name: this.name, colors, };
	}

	static fromJSON(json: PaletteData) {
		const colors: Record<string, Color> = {};
		for (const [k, v] of Object.entries(json.colors)) {
			colors[k] = Color.parse(v);
		}
		return new Palette(json.id, json.name, colors, false);
	}
}

const defaultPalette = new Palette("official/palette-manager/default", "Spotify • default", def_fields);

export class PaletteManager {
	public static INSTANCE = new PaletteManager();
	staticPalettes = new Set<Palette>([defaultPalette]);
	userPalettes = new Set<Palette>;
	private palette!: Palette;
	private stylesheet = document.createElement("style");

	private constructor() {
		document.head.appendChild(this.stylesheet);

		const paletteStr = storage.getItem("palette");
		const palette: Palette = paletteStr ? Palette.fromJSON(JSON.parse(paletteStr)) : this.getDefault();

		this.setCurrent(palette);

		this.initUserPalettes();
	}

	private initUserPalettes() {
		const userPalettesJSON: PaletteData[] = JSON.parse(storage.getItem("user_palettes") || "[]");
		const userPalettes = userPalettesJSON.map(json => Palette.fromJSON(json));
		for (const palette of userPalettes) {
			this.userPalettes.add(palette);
			if (this.isCurrent(palette)) {
				this.setCurrent(palette);
			}
		}
	}

	public getDefault(): Palette {
		return this.staticPalettes.keys().next().value;
	}

	public getPalettes(): Palette[] {
		return [...this.userPalettes, ...this.staticPalettes];
	}

	public save(): void {
		storage.setItem("user_palettes", JSON.stringify(Array.from(this.userPalettes)));
	}

	public getCurrent(): Palette {
		return this.palette;
	}

	public setCurrent(palette: Palette) {
		this.palette = palette;
		this.writeCurrent();
		return palette;
	}

	public writeCurrent() {
		this.stylesheet.innerHTML = `.encore-dark-theme { ${this.palette.toCSS()} }`;
		this.saveCurrent();
	}

	public saveCurrent(): void {
		storage.setItem("palette", JSON.stringify(this.palette));
	}

	public addUserPalette(palette: Palette) {
		this.userPalettes.add(palette);
		this.save();
	}

	public deleteUserPalette(palette: Palette) {
		this.userPalettes.delete(palette);
		if (this.isCurrent(palette)) {
			this.setCurrent(this.getDefault());
		}
		this.save();
	}

	public renameUserPalette(palette: Palette, name: string) {
		palette.name = name;
		if (this.isCurrent(palette)) {
			this.saveCurrent();
		}
		this.save();
	}

	public isCurrent(palette: Palette) {
		return palette.id === this.getCurrent().id;
	}
}
