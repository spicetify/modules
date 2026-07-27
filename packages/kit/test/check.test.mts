import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkMetadata, checkSource } from "../src/check.ts";

const goodMeta = {
	name: "my-module",
	version: "1.0.0",
	description: "does a thing",
	authors: ["me"],
	entries: { js: "index.js" },
	hasMixins: false,
	dependencies: {},
};

describe("checkMetadata", () => {
	it("passes a well-formed metadata", () => {
		assert.deepEqual(checkMetadata(goodMeta), []);
	});

	it("flags a non-kebab name, bad version, and missing dependencies", () => {
		const findings = checkMetadata({ ...goodMeta, name: "MyModule", version: "1.0", dependencies: undefined });
		const rules = findings.map((f) => f.rule).sort();
		assert.deepEqual(rules, ["metadata.dependencies", "metadata.name", "metadata.version"]);
		assert.ok(findings.every((f) => f.severity === "error"));
	});
});

describe("checkSource", () => {
	it("flags a second React import", () => {
		const f = checkSource("mod.tsx", 'import React from "https://esm.sh/react@18";');
		assert.equal(f[0].rule, "one-react");
	});

	it("does not flag the jsx-runtime import", () => {
		assert.deepEqual(checkSource("mod.tsx", 'import x from "https://esm.sh/react@18/jsx-runtime";'), []);
	});

	it("flags a hardcoded client hash in className", () => {
		const f = checkSource("mod.tsx", '<div className="M4MOhDLjSPUuMog9WxIM" />');
		assert.equal(f[0].rule, "map-intact");
	});

	it("leaves spicetify- and MAP-derived classes alone", () => {
		assert.deepEqual(checkSource("mod.tsx", '<div className="spicetify-button" />'), []);
		assert.deepEqual(checkSource("mod.tsx", "<div className={MAP.main.topbar.wrapper} />"), []);
	});

	it("nudges hand-rolled shared chrome toward the kit", () => {
		const f = checkSource("mod.ts", 'const s = el("select", "spicetify-select");');
		assert.equal(f[0].rule, "use-the-kit");
	});

	it("nudges a hardcoded context-menu row toward the kit's MenuItem, in any form", () => {
		for (
			const line of [
				'<button className="main-contextMenu-menuItemButton" />',
				'<button className={"main-contextMenu-menuItemButton"} />',
				"<button className={`main-contextMenu-menuItemButton ${extra}`} />",
				'const b = el("button", "main-contextMenu-menuItemButton");',
			]
		) {
			assert.equal(checkSource("mod.tsx", line)[0]?.rule, "use-the-kit", line);
		}
	});

	it("exempts the kit's own source, which owns the menu-item class", () => {
		const line = 'export const MENU_ITEM_CLASS = "main-contextMenu-menuItemButton";';
		assert.deepEqual(checkSource("lib/ui-classes.ts", line), []);
	});
});
