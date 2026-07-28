/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./test-setup.mts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	Badge,
	Button,
	Card,
	Chip,
	ConfirmButton,
	h,
	IconButton,
	openDialog,
	Select,
	Textarea,
	TextInput,
} from "./primitives-vanilla.ts";

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
		assert.equal(
			Button({ label: "a", variant: "secondary", onClick() {} }).className,
			"spicetify-button spicetify-button--secondary",
		);
		assert.equal(
			Button({ label: "a", variant: "danger", onClick() {} }).className,
			"spicetify-button spicetify-button--danger",
		);
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
			options: [
				{ value: "a", label: "A" },
				{ value: "b", label: "B" },
			],
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

describe("Badge", () => {
	it("renders text and maps tones to modifiers", () => {
		assert.equal(Badge({ text: "1.0.0" }).outerHTML, '<span class="spicetify-badge">1.0.0</span>');
		assert.equal(Badge({ text: "ok", tone: "ok" }).className, "spicetify-badge spicetify-badge--ok");
		assert.equal(Badge({ text: "bad", tone: "bad" }).className, "spicetify-badge spicetify-badge--bad");
	});
});

describe("Chip", () => {
	it("marks active and fires onClick", () => {
		let clicks = 0;
		assert.equal(Chip({ label: "All", active: false, onClick() {} }).className, "spicetify-chip");
		const active = Chip({ label: "All", active: true, onClick: () => clicks++ });
		assert.equal(active.className, "spicetify-chip spicetify-chip--active");
		active.dispatchEvent(new MouseEvent("click"));
		assert.equal(clicks, 1);
	});
});

describe("Card", () => {
	it("wraps children in an article container in order", () => {
		const a = h("span", { textContent: "a" });
		const b = h("span", { textContent: "b" });
		const card = Card({ children: [a, b] });
		assert.equal(card.tagName, "ARTICLE");
		assert.equal(card.className, "spicetify-card");
		assert.deepEqual([...card.children], [a, b]);
	});
});

describe("ConfirmButton", () => {
	it("requires two clicks: first arms, second confirms", () => {
		let confirmed = 0;
		const btn = ConfirmButton({ label: "Reset", confirmLabel: "Really?", onConfirm: () => confirmed++ });
		assert.equal(btn.textContent, "Reset");
		btn.dispatchEvent(new MouseEvent("click"));
		assert.equal(btn.textContent, "Really?");
		assert.equal(confirmed, 0);
		btn.dispatchEvent(new MouseEvent("click"));
		assert.equal(confirmed, 1);
	});

	it("re-arms after the window: a lone late click does not confirm", () => {
		let confirmed = 0;
		let scheduled: (() => void) | undefined;
		const btn = ConfirmButton({
			label: "Reset",
			confirmLabel: "Really?",
			onConfirm: () => confirmed++,
			// Inject the timer so the arm window is deterministic under node:test.
			setTimer: (fn) => {
				scheduled = fn;
				return 0;
			},
			clearTimer: () => {
				scheduled = undefined;
			},
		});
		btn.dispatchEvent(new MouseEvent("click"));
		assert.equal(btn.textContent, "Really?");
		scheduled?.(); // window elapses
		assert.equal(btn.textContent, "Reset");
		btn.dispatchEvent(new MouseEvent("click")); // arms again, does not confirm
		assert.equal(confirmed, 0);
	});
});

describe("openDialog", () => {
	it("mounts a scrim+dialog, returns a body, and tears down on close or backdrop", () => {
		const one = openDialog({ title: "New snippet", children: [h("p", { textContent: "hi" })] });
		assert.ok(document.querySelector(".spicetify-scrim"));
		assert.ok(one.body.closest(".spicetify-dialog"));
		assert.equal(one.body.querySelector("p")?.textContent, "hi");
		one.close();
		assert.equal(document.querySelector(".spicetify-scrim"), null);

		// Backdrop click runs the same teardown.
		const two = openDialog({ title: "T", children: [] });
		const scrim = document.querySelector(".spicetify-scrim") as HTMLElement;
		scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		assert.equal(document.querySelector(".spicetify-scrim"), null);
		void two;
	});

	it("fires onClose exactly once, on every dismissal path", () => {
		// Programmatic close.
		let a = 0;
		openDialog({ title: "A", children: [], onClose: () => a++ }).close();
		assert.equal(a, 1);

		// The × button.
		let b = 0;
		openDialog({ title: "B", children: [], onClose: () => b++ });
		(document.querySelector(".spicetify-scrim .spicetify-button-circle") as HTMLElement).dispatchEvent(
			new MouseEvent("click"),
		);
		assert.equal(b, 1);

		// Backdrop, and no double-fire if close() is also called afterward.
		let c = 0;
		const handle = openDialog({ title: "C", children: [], onClose: () => c++ });
		(document.querySelector(".spicetify-scrim") as HTMLElement).dispatchEvent(new MouseEvent("click"));
		handle.close();
		assert.equal(c, 1);
	});

	it("rejects a misspelled event handler at the type level", () => {
		// @ts-expect-error onClik is not a real DOM event handler
		h("button", { onClik: () => {} });
	});
});
