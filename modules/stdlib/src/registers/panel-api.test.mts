/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const registrarSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./panel.ts", import.meta.url), "utf8");
const panelLogicSource = await readFile(new URL("./panel-logic.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../../index.scss", import.meta.url), "utf8");
const popoverSource = await readFile(new URL("../../lib/popover.ts", import.meta.url), "utf8");
const dialogLifecycleSource = await readFile(new URL("../../lib/dialog-lifecycle.ts", import.meta.url), "utf8");
const metadata = JSON.parse(await readFile(new URL("../../metadata.json", import.meta.url), "utf8"));
const kitPackage = JSON.parse(
	await readFile(new URL("../../../../packages/kit/package.json", import.meta.url), "utf8"),
);

describe("owned panel public API", () => {
	it("exposes a typed registrar method returning a panel controller", () => {
		assert.match(registrarSource, /export type \{\s*PanelController,\s*PanelRegistration,\s*PanelWidth\s*\}/);
		assert.match(registrarSource, /registerPanel\([^)]*options:[^)]*\)\s*:\s*PanelController/);
		assert.match(registrarSource, /id:\s*`\$\{this\.id\}:\$\{options\.id\s*\?\?\s*"default"\}`/);
		assert.match(registrarSource, /this\.disposers\.add\(dispose\)/);
	});

	it("contains no private Spotify state-machine or chunk transforms", () => {
		assert.doesNotMatch(panelSource, /transformer\s*\(/);
		assert.doesNotMatch(panelSource, /__Machine|dwp-panel-section|RightPanelState|xstate/);
	});

	it("retires a stale coordinator when the stdlib register module is replaced", () => {
		assert.match(panelSource, /Symbol\.for\(["']spicetify\.stdlib\.panel-coordinator["']\)/);
		assert.match(panelSource, /previousCoordinator\?\.dispose\(\)/);
	});

	it("keeps owned close chrome outside the module content error boundary", () => {
		assert.match(panelSource, /const PanelContent = \(\) =>[\s\S]+panel\.render\(\)/);
		assert.match(panelSource, /React\.createElement\(PanelBoundary, null, React\.createElement\(PanelContent\)\)/);
		assert.match(panelSource, /root\.render\(React\.createElement\(PanelSurface\)\)/);
		assert.doesNotMatch(panelSource, /root\.render\(React\.createElement\(PanelBoundary/);
	});

	it("owns the active sidebar grid track and panel surface", () => {
		assert.match(panelLogicSource, /const trailingTracks = gridTracks\([\s\S]+?\)\.slice\(3\)/);
		assert.match(panelLogicSource, /"--spicetify-panel-trailing-width"/);
		assert.match(panelLogicSource, /"grid-template-columns"[\s\S]+\.\.\.trailingTracks/);
		assert.match(panelLogicSource, /setOwnedStyle\(sidebar,\s*"width",\s*"var\(--spicetify-panel-width\)"\)/);
		assert.match(styles, /--spicetify-panel-width:\s*var\(--spicetify-panel-requested-width\)/);
		assert.match(styles, /\.spicetify-panel-host\s*\{[^}]*display:\s*flex[^}]*background:\s*var\(--spice-main/s);
		assert.doesNotMatch(styles, /\.spicetify-panel-host:focus\s*\{[^}]*outline:\s*none/s);
		assert.match(styles, /\.spicetify-panel-host:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px/s);
		assert.match(
			styles,
			/\[data-spicetify-panel-active\][^{]*\.Root__right-sidebar\s*>\s*\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/s,
		);
		assert.match(styles, /@media\s*\(max-width:\s*800px\)[^{]*\{[^}]*--spicetify-panel-width/s);
		assert.match(styles, /var\(--spicetify-panel-trailing-width,\s*0px\)/);
	});

	it("lets the topmost stdlib overlay consume Escape before the panel", () => {
		for (const source of [popoverSource, dialogLifecycleSource]) {
			assert.match(source, /(?:e|event)\.preventDefault\(\)/);
			assert.match(source, /(?:e|event)\.stopPropagation\(\)/);
		}
		assert.match(panelLogicSource, /event\.defaultPrevented/);
	});

	it("ships the current stdlib release", () => {
		assert.equal(metadata.version, "1.10.0");
		assert.equal(kitPackage.spicetify.stdlibVersion, "1.10.0");
	});
});
