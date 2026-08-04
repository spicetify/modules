/* Copyright (C) 2024 harbassan, and Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createStorage, type ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { Color } from "/modules/stdlib/src/webpack/misc.xpui.ts";

import { deserializeColors, paletteCSS, serializePalette, type PaletteData } from "./palette-logic.ts";

let storage: Storage;
export default function (ctx: ModuleRuntimeContext) {
	storage = createStorage(ctx);
	PaletteManager.INSTANCE._init();
}

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

export class Palette {
	constructor(
		public id: string,
		public name: string,
		public colors: Record<string, Color>,
		public isStatic = true,
	) {}

	overwrite(map: Record<string, Color>) {
		if (this.isStatic) {
			return false;
		}
		this.colors = map;
		return true;
	}

	toCSS() {
		return paletteCSS(this.colors, Color.Format.HEX);
	}

	toJSON(): PaletteData {
		return serializePalette(this.id, this.name, this.colors);
	}

	static fromJSON(json: PaletteData) {
		return new Palette(json.id, json.name, deserializeColors(json, Color.parse), false);
	}
}

const defaultPalette = new Palette("default", "Spotify • default", def_fields);

export class PaletteManager {
	public static INSTANCE = new PaletteManager();
	staticPalettes = new Map<string, Palette>([[defaultPalette.id, defaultPalette]]);
	userPalettes = new Set<Palette>();
	private palette!: Palette;
	private stylesheet = document.createElement("style");

	private constructor() {
		document.head.appendChild(this.stylesheet);
	}

	_init() {
		const paletteStr = storage.getItem("palette");
		const palette: Palette = paletteStr ? Palette.fromJSON(JSON.parse(paletteStr)) : this.getDefault();

		this.setCurrent(palette);

		this.initUserPalettes();
	}

	private initUserPalettes() {
		const userPalettesJSON: PaletteData[] = JSON.parse(storage.getItem("user_palettes") || "[]");
		const userPalettes = userPalettesJSON.map((json) => Palette.fromJSON(json));
		for (const palette of userPalettes) {
			this.userPalettes.add(palette);
			if (this.isCurrent(palette)) {
				this.setCurrent(palette);
			}
		}
	}

	public getDefault(): Palette {
		return this.staticPalettes.values().next().value;
	}

	public getPalettes(): Palette[] {
		return [...this.userPalettes, ...this.staticPalettes.values()];
	}

	public save(): void {
		storage.setItem("user_palettes", JSON.stringify(Array.from(this.userPalettes)));
	}

	public getCurrent(): Palette {
		return this.palette;
	}

	public setCurrent(palette: Palette): Palette {
		this.palette = palette;
		this.writeCurrent();
		return palette;
	}

	public writeCurrent() {
		// :root.encore-dark-theme outranks the classic pipeline's :root rule
		// in colors.css; the class lives on <html>, where plain
		// .encore-dark-theme ties with :root and loses on document order.
		this.stylesheet.textContent = `.encore-dark-theme, :root.encore-dark-theme { ${this.palette.toCSS()} }`;
		this.saveCurrent();
	}

	public saveCurrent() {
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
