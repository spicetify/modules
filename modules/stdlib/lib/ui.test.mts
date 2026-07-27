/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./test-setup.mts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Button, h, IconButton, Select, Textarea, TextInput } from "./ui.ts";

describe("h()", () => {
	it("creates a typed element with class and text", () => {
		const node = h("div", { className: "x", textContent: "hi" });
		assert.equal(node.tagName, "DIV");
		assert.equal(node.className, "x");
		assert.equal(node.textContent, "hi");
	});

	it("maps on<Event> props to listeners", () => {
		let clicks = 0;
		const node = h("button", { onClick: () => clicks++ });
		node.dispatchEvent(new MouseEvent("click"));
		assert.equal(clicks, 1);
	});

	it("assigns known element properties without a cast", () => {
		const input = h("input", { value: "v", disabled: true, placeholder: "p" });
		assert.equal(input.value, "v");
		assert.equal(input.disabled, true);
		assert.equal(input.placeholder, "p");
	});

	it("applies dataset and aria attributes", () => {
		const node = h("button", { dataset: { confirm: "1" }, "aria-label": "Close" });
		assert.equal(node.dataset.confirm, "1");
		assert.equal(node.getAttribute("aria-label"), "Close");
	});

	it("flattens and skips falsy children in order", () => {
		const node = h("div", null, "a", false, ["b", null, "c"]);
		assert.equal(node.textContent, "abc");
	});
});

describe("Button", () => {
	it("renders a primary pill and fires onClick once", () => {
		let clicks = 0;
		const btn = Button({ label: "Install", onClick: () => clicks++ });
		assert.equal(btn.tagName, "BUTTON");
		assert.equal(btn.className, "spicetify-button");
		assert.equal(btn.textContent, "Install");
		btn.dispatchEvent(new MouseEvent("click"));
		assert.equal(clicks, 1);
	});

	it("maps variants to modifier classes", () => {
		assert.equal(Button({ label: "a", variant: "secondary", onClick() {} }).className, "spicetify-button spicetify-button--secondary");
		assert.equal(Button({ label: "a", variant: "danger", onClick() {} }).className, "spicetify-button spicetify-button--danger");
		assert.equal(Button({ label: "a", variant: "primary", onClick() {} }).className, "spicetify-button");
	});

	it("sets the disabled property", () => {
		assert.equal(Button({ label: "a", onClick() {}, disabled: true }).disabled, true);
	});
});

describe("IconButton", () => {
	it("renders a circle button with glyph and aria-label", () => {
		const btn = IconButton({ glyph: "×", ariaLabel: "Close", onClick() {} });
		assert.equal(btn.className, "spicetify-button-circle");
		assert.equal(btn.textContent, "×");
		assert.equal(btn.getAttribute("aria-label"), "Close");
	});
});

describe("Select", () => {
	it("renders options, marks the value selected, and reports the chosen value", () => {
		let picked = "";
		const sel = Select({
			options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
			value: "b",
			onChange: (v) => (picked = v),
		});
		assert.equal(sel.className, "spicetify-select");
		assert.equal(sel.options.length, 2);
		assert.equal(sel.value, "b");
		sel.value = "a";
		sel.dispatchEvent(new Event("change"));
		assert.equal(picked, "a");
	});
});

describe("TextInput / Textarea", () => {
	it("applies placeholder and value and fires onInput", () => {
		let val = "";
		const input = TextInput({ placeholder: "search", value: "x", onInput: (v) => (val = v) });
		assert.equal(input.className, "spicetify-searchbar");
		assert.equal(input.placeholder, "search");
		assert.equal(input.value, "x");
		input.value = "y";
		input.dispatchEvent(new Event("input"));
		assert.equal(val, "y");
	});

	it("Textarea carries value and placeholder", () => {
		const ta = Textarea({ placeholder: "css", value: "body{}" });
		assert.equal(ta.tagName, "TEXTAREA");
		assert.equal(ta.placeholder, "css");
		assert.equal(ta.value, "body{}");
	});
});
