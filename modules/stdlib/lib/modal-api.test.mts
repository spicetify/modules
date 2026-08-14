/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = async (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const readJson = async (path: string) => JSON.parse(await read(path));

const modalSource = await read("./modal.tsx");
const primitivesSource = await read("./primitives.tsx");
const classesSource = await read("./primitives-classes.ts");
const styles = await read("../index.scss");
const barrel = await read("../mod.ts");
const clientSource = await read("../src/client.ts");

const consumers = {
	"palette-manager": await read("../../palette-manager/paletteManager.tsx"),
	"lyrics-plus": await read("../../lyrics-plus/settings.tsx"),
	"popup-lyrics": await read("../../popup-lyrics/mod.tsx"),
	"full-app-display": await read("../../full-app-display/mod.tsx"),
};

describe("stdlib-owned modal API", () => {
	it("exports one imperative API backed only by stdlib dialog chrome", () => {
		assert.match(barrel, /display\s+as\s+displayModal/);
		assert.match(barrel, /hide\s+as\s+hideModal/);
		assert.match(modalSource, /<Dialog\b/);
		assert.doesNotMatch(modalSource, /MAP\.|GenericModal|trackCreditsModal|embedWidgetGenerator/);
		assert.doesNotMatch(modalSource, /createIconComponent|ReactComponents/);
	});

	it("owns normal and large responsive surfaces with no client modal classes", () => {
		assert.match(classesSource, /DIALOG_LARGE_CLASS\s*=\s*["']spicetify-dialog--large["']/);
		assert.match(primitivesSource, /size\?:\s*["']normal["']\s*\|\s*["']large["']/);
		assert.match(styles, /\.spicetify-dialog--large\s*\{[^}]*width:\s*min\(/s);
		assert.match(styles, /\.spicetify-dialog\s*\{[^}]*overflow:\s*hidden/s);
		assert.match(styles, /\.spicetify-dialog-body\s*\{[^}]*overflow-y:\s*auto/s);
	});

	it("routes every first-party imperative modal through stdlib", () => {
		for (const [name, source] of Object.entries(consumers)) {
			assert.match(source, /displayModal\s*\(/, `${name} must call displayModal()`);
			assert.doesNotMatch(
				source,
				/Spicetify\.PopupModal|client\.popupModal/,
				`${name} still uses the legacy modal`,
			);
		}
	});

	it("adapts the deprecated client capability instead of forwarding the global", () => {
		assert.match(clientSource, /import\(["']\.\.\/lib\/modal\.tsx["']\)/);
		assert.doesNotMatch(clientSource, /return\s+runtime\(\)\.PopupModal/);
	});

	it("requires the stdlib version that supplies the owned API", async () => {
		const stdlibMinor = Number((await readJson("../metadata.json")).version.split(".")[1]);
		assert.ok(stdlibMinor >= 8);
		for (const name of Object.keys(consumers)) {
			const metadata = await readJson(`../../${name}/metadata.json`);
			const requiredMinor = Number(metadata.dependencies.stdlib.match(/^\^1\.(\d+)\.0$/)?.[1]);
			assert.ok(requiredMinor >= 8, `${name} must require stdlib 1.8.0 or newer`);
		}
	});
});
