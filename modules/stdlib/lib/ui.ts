/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A vanilla, React-free component kit for module UIs. Every primitive is
 * a plain function returning a typed HTMLElement, built on the `h()`
 * hyperscript, and applies the shared `.spicetify-*` chrome classes from
 * stdlib's stylesheet. Because it touches nothing but `document`, it is
 * safe on standalone module surfaces (anchors, body dialogs, popovers)
 * where the client React instance and client webpack components are
 * unavailable — the same tier-2 role the chrome classes already fill,
 * now as named, composable primitives.
 *
 * Inside a client React tree, prefer the real client components via
 * stdlib's ComponentLibrary; this kit is for module-owned DOM.
 */

type EventName<K extends string> = K extends `on${infer E}` ? Lowercase<E> : never;

// Props for h(): className/textContent/style, dataset, aria-* attributes,
// on<Event> listeners, and any writable property of the element itself
// (value, disabled, placeholder, type, ...), so consumers never cast.
export type Props<K extends keyof HTMLElementTagNameMap> =
	& Partial<Omit<HTMLElementTagNameMap[K], "style" | "children" | "dataset">>
	& {
		className?: string;
		dataset?: Record<string, string>;
		style?: Partial<CSSStyleDeclaration>;
		[ariaOrData: `aria-${string}`]: string | undefined;
		[on: `on${string}`]: ((event: Event) => void) | undefined;
	};

export type Child = string | Node | false | null | undefined | Child[];

const appendChild = (parent: HTMLElement, child: Child): void => {
	if (child === false || child === null || child === undefined) return;
	if (Array.isArray(child)) {
		for (const c of child) appendChild(parent, c);
		return;
	}
	parent.append(child);
};

// h - typed hyperscript. The generalized, exported successor to the
// store's local el(); assigns known element properties directly (so no
// `as HTMLXElement` casts), maps on<Event> keys to addEventListener, and
// flattens truthy children.
export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props?: Props<K> | null,
	...children: Child[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (props) {
		for (const [key, value] of Object.entries(props)) {
			if (value === undefined) continue;
			if (key === "dataset") {
				Object.assign(node.dataset, value);
			} else if (key === "style") {
				Object.assign(node.style, value);
			} else if (key.startsWith("aria-")) {
				node.setAttribute(key, value as string);
			} else if (key.startsWith("on") && typeof value === "function") {
				node.addEventListener(key.slice(2).toLowerCase() as EventName<typeof key>, value as EventListener);
			} else {
				(node as Record<string, unknown>)[key] = value;
			}
		}
	}
	for (const child of children) appendChild(node, child);
	return node;
}

// ---------- buttons ----------

export type ButtonVariant = "primary" | "secondary" | "danger";

const buttonClass = (variant: ButtonVariant = "primary") =>
	variant === "primary" ? "spicetify-button" : `spicetify-button spicetify-button--${variant}`;

export function Button(
	props: { label: string; variant?: ButtonVariant; onClick: () => void; disabled?: boolean; icon?: Node },
): HTMLButtonElement {
	return h(
		"button",
		{ type: "button", className: buttonClass(props.variant), disabled: props.disabled, onClick: props.onClick },
		props.icon,
		props.label,
	);
}

// The circular icon button Spotify uses for modal close (Credits, etc).
export function IconButton(
	props: { glyph: string; ariaLabel: string; onClick: () => void },
): HTMLButtonElement {
	return h("button", {
		type: "button",
		className: "spicetify-button-circle",
		"aria-label": props.ariaLabel,
		textContent: props.glyph,
		onClick: props.onClick,
	});
}

// ---------- inputs ----------

export function Select<T extends string>(
	props: { options: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (value: T) => void },
): HTMLSelectElement {
	const select = h("select", {
		className: "spicetify-select",
		onChange: () => props.onChange(select.value as T),
	});
	for (const option of props.options) {
		select.append(h("option", { value: option.value, textContent: option.label, selected: option.value === props.value }));
	}
	select.value = props.value;
	return select;
}

export function TextInput(
	props: { placeholder?: string; value?: string; onInput?: (value: string) => void; disabled?: boolean },
): HTMLInputElement {
	const input = h("input", {
		type: "text",
		className: "spicetify-searchbar",
		placeholder: props.placeholder,
		value: props.value,
		disabled: props.disabled,
		onInput: props.onInput ? () => props.onInput!(input.value) : undefined,
	});
	return input;
}

export function Textarea(
	props: { placeholder?: string; value?: string; onInput?: (value: string) => void },
): HTMLTextAreaElement {
	const textarea = h("textarea", {
		placeholder: props.placeholder,
		value: props.value,
		onInput: props.onInput ? () => props.onInput!(textarea.value) : undefined,
	});
	return textarea;
}

// ---------- badges, chips, cards ----------

export type BadgeTone = "neutral" | "ok" | "bad";

export function Badge(props: { text: string; tone?: BadgeTone }): HTMLSpanElement {
	const cls = props.tone && props.tone !== "neutral" ? `spicetify-badge spicetify-badge--${props.tone}` : "spicetify-badge";
	return h("span", { className: cls, textContent: props.text });
}

export function Chip(props: { label: string; active: boolean; onClick: () => void }): HTMLButtonElement {
	return h("button", {
		type: "button",
		className: props.active ? "spicetify-chip spicetify-chip--active" : "spicetify-chip",
		textContent: props.label,
		onClick: props.onClick,
	});
}

// A plain elevated container; slot layout is the consumer's own concern.
export function Card(props: { children: Child }): HTMLElement {
	return h("article", { className: "spicetify-card" }, props.children);
}

// ---------- two-step confirm ----------

// ConfirmButton encapsulates the arm-then-confirm pattern: the first
// click swaps the label and arms a revert timer; a second click within
// the window confirms. Timers are injectable so the window is
// deterministic under test.
export function ConfirmButton(props: {
	label: string;
	confirmLabel: string;
	onConfirm: () => void;
	variant?: ButtonVariant;
	windowMs?: number;
	setTimer?: (fn: () => void, ms: number) => number;
	clearTimer?: (handle: number) => void;
}): HTMLButtonElement {
	const setTimer = props.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
	const clearTimer = props.clearTimer ?? ((handle) => clearTimeout(handle));
	let armed: number | null = null;
	const disarm = () => {
		if (armed !== null) clearTimer(armed);
		armed = null;
		button.textContent = props.label;
	};
	const button = h("button", {
		type: "button",
		className: buttonClass(props.variant),
		textContent: props.label,
		onClick: () => {
			if (armed !== null) {
				disarm();
				props.onConfirm();
				return;
			}
			button.textContent = props.confirmLabel;
			armed = setTimer(disarm, props.windowMs ?? 4000);
		},
	});
	return button;
}

// ---------- dialog ----------

export interface DialogHandle {
	body: HTMLElement;
	close: () => void;
}

// openDialog mounts a scrim + dialog (with a title and circular close),
// appends it to document.body, and returns the body plus a close(). The
// backdrop and close button both run the same teardown.
export function openDialog(props: { title: string; children: Child }): DialogHandle {
	const body = h("div", { className: "spicetify-dialog-body" }, props.children);
	const close = () => scrim.remove();
	const header = h(
		"div",
		{ className: "spicetify-dialog-header" },
		h("h2", { textContent: props.title }),
		IconButton({ glyph: "×", ariaLabel: "Close", onClick: close }),
	);
	const dialog = h("div", { className: "spicetify-dialog" }, header, body);
	const scrim = h("div", {
		className: "spicetify-scrim",
		onClick: (e) => {
			if (e.target === scrim) close();
		},
	}, dialog);
	document.body.append(scrim);
	return { body, close };
}
