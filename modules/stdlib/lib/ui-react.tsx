/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The React tier of the component kit: the same Spotify-look chrome as
 * the vanilla kit (lib/ui.ts), as React components for module UI that
 * already renders inside a React tree (routes, registers, modals). Both
 * tiers apply the shared class contract (ui-classes.ts) so they can
 * never drift.
 *
 * Deep-import at runtime: `import { Button } from
 * "/modules/stdlib/lib/ui-react.js"`. This is not in the mod.ts barrel
 * to avoid colliding with the vanilla kit's identical export names; a
 * module uses one tier. Requires the client React instance, so only
 * modules that declare stdlib as a dependency should use it (the vanilla
 * kit is the React-free choice for standalone surfaces).
 */

import { React, ReactDOM } from "../src/expose/React.ts";
import {
	badgeClass,
	buttonClass,
	type BadgeTone,
	type ButtonVariant,
	CARD_CLASS,
	chipClass,
	DIALOG_BODY_CLASS,
	DIALOG_CLASS,
	DIALOG_HEADER_CLASS,
	ICON_BUTTON_CLASS,
	MENU_ITEM_CLASS,
	SCRIM_CLASS,
	SEARCHBAR_CLASS,
	SELECT_CLASS,
} from "./ui-classes.ts";

export type { BadgeTone, ButtonVariant } from "./ui-classes.ts";

// ---------- buttons ----------

export const Button: React.FC<{
	variant?: ButtonVariant;
	disabled?: boolean;
	onClick?: () => void;
	children: React.ReactNode;
}> = (props) => (
	<button type="button" className={buttonClass(props.variant)} disabled={props.disabled} onClick={props.onClick}>
		{props.children}
	</button>
);

// The circular icon button Spotify uses for modal close (Credits, etc).
export const IconButton: React.FC<{ ariaLabel: string; onClick?: () => void; children: React.ReactNode }> = (props) => (
	<button type="button" className={ICON_BUTTON_CLASS} aria-label={props.ariaLabel} onClick={props.onClick}>
		{props.children}
	</button>
);

// ---------- inputs ----------

export function Select<T extends string>(props: {
	options: ReadonlyArray<{ value: T; label: string }>;
	value: T;
	onChange: (value: T) => void;
}): React.ReactElement {
	return (
		<select className={SELECT_CLASS} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
			{props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
		</select>
	);
}

export const TextInput: React.FC<{
	placeholder?: string;
	value?: string;
	disabled?: boolean;
	onInput?: (value: string) => void;
}> = (props) => (
	<input
		type="text"
		className={SEARCHBAR_CLASS}
		placeholder={props.placeholder}
		value={props.value}
		disabled={props.disabled}
		onChange={(e) => props.onInput?.(e.target.value)}
	/>
);

export const Textarea: React.FC<{
	placeholder?: string;
	value?: string;
	onInput?: (value: string) => void;
}> = (props) => (
	<textarea placeholder={props.placeholder} value={props.value} onChange={(e) => props.onInput?.(e.target.value)} />
);

// ---------- badges, chips, cards ----------

export const Badge: React.FC<{ tone?: BadgeTone; children: React.ReactNode }> = (props) => (
	<span className={badgeClass(props.tone)}>{props.children}</span>
);

export const Chip: React.FC<{ active: boolean; onClick?: () => void; children: React.ReactNode }> = (props) => (
	<button type="button" className={chipClass(props.active)} onClick={props.onClick}>
		{props.children}
	</button>
);

// A plain elevated container; slot layout is the consumer's own concern.
export const Card: React.FC<{ children: React.ReactNode }> = (props) => (
	<article className={CARD_CLASS}>{props.children}</article>
);

// ---------- context-menu item ----------

// A row for one of Spotify's context menus — register it through the
// "menu" register. It owns the native context-menu class so module code
// gets Spotify styling without ever naming a client class; pass `className`
// only for a module-specific hook on top of the native look.
export const MenuItem: React.FC<{
	onClick?: () => void;
	className?: string;
	children: React.ReactNode;
}> = (props) => (
	<button
		type="button"
		role="menuitem"
		className={props.className ? `${MENU_ITEM_CLASS} ${props.className}` : MENU_ITEM_CLASS}
		onClick={props.onClick}
	>
		<span>{props.children}</span>
	</button>
);

// ---------- two-step confirm ----------

// The arm-then-confirm pattern: the first click swaps the label and arms
// a revert timer; a second click within the window confirms.
export const ConfirmButton: React.FC<{
	label: string;
	confirmLabel: string;
	onConfirm: () => void;
	variant?: ButtonVariant;
	windowMs?: number;
}> = (props) => {
	const [armed, setArmed] = React.useState(false);
	const timer = React.useRef<ReturnType<typeof setTimeout>>();
	React.useEffect(() => () => clearTimeout(timer.current), []);
	return (
		<button
			type="button"
			className={buttonClass(props.variant)}
			onClick={() => {
				if (armed) {
					clearTimeout(timer.current);
					setArmed(false);
					props.onConfirm();
					return;
				}
				setArmed(true);
				timer.current = setTimeout(() => setArmed(false), props.windowMs ?? 4000);
			}}
		>
			{armed ? props.confirmLabel : props.label}
		</button>
	);
};

// ---------- dialog ----------

// Modal chrome: the consumer controls mounting with a conditional render
// (`{open && <Dialog ... />}`), the idiomatic React equivalent of the
// vanilla kit's openDialog(). It portals to document.body so the
// position:fixed scrim anchors to the viewport — a fixed element inside a
// transformed ancestor (the norm for Spotify's scroll containers) would
// otherwise be clipped/offset to that ancestor. The backdrop and the ×
// button both call onClose.
export const Dialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = (props) =>
	ReactDOM.createPortal(
		<div
			className={SCRIM_CLASS}
			onClick={(e) => {
				if (e.target === e.currentTarget) props.onClose();
			}}
		>
			<div className={DIALOG_CLASS}>
				<div className={DIALOG_HEADER_CLASS}>
					<h2>{props.title}</h2>
					<IconButton ariaLabel="Close" onClick={props.onClose}>×</IconButton>
				</div>
				<div className={DIALOG_BODY_CLASS}>{props.children}</div>
			</div>
		</div>,
		document.body,
	);
