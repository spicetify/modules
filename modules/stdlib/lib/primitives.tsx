/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The React tier of the component kit: the reusable UI primitives, the
 * same Spotify-look chrome as the vanilla kit (lib/primitives-vanilla.ts) but as React
 * components for module UI that already renders inside a React tree
 * (routes, registers, modals). Both tiers apply the shared class contract
 * (primitives-classes.ts) so they can never drift.
 *
 * Deep-import at runtime: `import { Button } from
 * "/modules/stdlib/lib/primitives.js"`. This is not in the mod.ts barrel
 * to avoid colliding with the vanilla kit's identical export names; a
 * module uses one tier. Requires the client React instance, so only
 * modules that declare stdlib as a dependency should use it (the vanilla
 * kit is the React-free choice for standalone surfaces).
 */

import { React, ReactDOM } from "../src/expose/React.ts";
import {
	activateToggleOnKeyDown,
	TOGGLE_CLASSES,
	SETTINGS_ROW_CLASS,
	SETTINGS_ROW_CONTROL_CLASS,
	SETTINGS_ROW_LABEL_CLASS,
	SETTINGS_ROW_TEXT_CLASS,
	SETTINGS_ACTION_GROUP_CLASS,
	SETTINGS_HELP_TEXT_CLASS,
	SETTINGS_LABEL_COPY_CLASS,
	SETTINGS_SECTION_CLASS,
	SETTINGS_SECTION_HEADING_CLASS,
	badgeClass,
	buttonClass,
	type BadgeTone,
	type ButtonVariant,
	CARD_CLASS,
	chipClass,
	DIALOG_BODY_CLASS,
	DIALOG_CLASS,
	DIALOG_LARGE_CLASS,
	DIALOG_HEADER_CLASS,
	ICON_BUTTON_CLASS,
	MENU_ITEM_CLASS,
	SCRIM_CLASS,
	SEARCHBAR_CLASS,
	SELECT_CLASS,
} from "./primitives-classes.ts";
import { activateDialog } from "./dialog-lifecycle.ts";

export type { BadgeTone, ButtonVariant } from "./primitives-classes.ts";

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
export const IconButton: React.FC<{
	ariaLabel: string;
	disabled?: boolean;
	onClick?: () => void;
	children: React.ReactNode;
}> = (props) => (
	<button
		type="button"
		className={ICON_BUTTON_CLASS}
		aria-label={props.ariaLabel}
		disabled={props.disabled}
		onClick={props.onClick}
	>
		{props.children}
	</button>
);

// One shared ordering affordance for provider lists and other short ordered
// settings. Keeping the arrows here prevents each module from inventing a
// different size, icon, disabled state, or accessible label.
export const ReorderButtons: React.FC<{
	label: string;
	disableUp: boolean;
	disableDown: boolean;
	onMove: (direction: -1 | 1) => void;
}> = (props) => (
	<span className={SETTINGS_ACTION_GROUP_CLASS}>
		<IconButton ariaLabel={`Move ${props.label} up`} disabled={props.disableUp} onClick={() => props.onMove(-1)}>
			↑
		</IconButton>
		<IconButton ariaLabel={`Move ${props.label} down`} disabled={props.disableDown} onClick={() => props.onMove(1)}>
			↓
		</IconButton>
	</span>
);

// ---------- inputs ----------

export function Select<T extends string>(props: {
	options: ReadonlyArray<{ value: T; label: string }>;
	value: T;
	onChange: (value: T) => void;
	ariaLabel?: string;
}): React.ReactElement {
	return (
		<select
			className={SELECT_CLASS}
			value={props.value}
			aria-label={props.ariaLabel}
			onChange={(e) => props.onChange(e.target.value as T)}
		>
			{props.options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	);
}

export const TextInput: React.FC<{
	placeholder?: string;
	value?: string;
	disabled?: boolean;
	readOnly?: boolean;
	onInput?: (value: string) => void;
	onFocus?: React.FocusEventHandler<HTMLInputElement>;
	onBlur?: React.FocusEventHandler<HTMLInputElement>;
	ariaLabel?: string;
}> = (props) => (
	<input
		type="text"
		className={SEARCHBAR_CLASS}
		placeholder={props.placeholder}
		value={props.value}
		disabled={props.disabled}
		readOnly={props.readOnly}
		aria-label={props.ariaLabel}
		onFocus={props.onFocus}
		onBlur={props.onBlur}
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

// ---------- settings ----------

// Native-looking settings chrome for the `settingsSection` register on the
// standalone Spicetify Settings page. These render the client's own section
// and row structure rather than capturing its route-local components.
export const SettingsSection: React.FC<{ title?: React.ReactNode; children: React.ReactNode }> = (props) => (
	<div className={SETTINGS_SECTION_CLASS}>
		{props.title === undefined ? null : <h2 className={SETTINGS_SECTION_HEADING_CLASS}>{props.title}</h2>}
		{props.children}
	</div>
);

// One labelled row. `label` fills the client's first column and `children`
// the control column, so a toggle or select lines up with the native rows
// above and below it.
export const SettingsRow: React.FC<{ label: React.ReactNode; htmlFor?: string; children: React.ReactNode }> = (
	props,
) => (
	<div className={SETTINGS_ROW_CLASS}>
		<div className={SETTINGS_ROW_LABEL_CLASS}>
			{props.htmlFor === undefined ? (
				<span className={SETTINGS_ROW_TEXT_CLASS}>{props.label}</span>
			) : (
				<label className={SETTINGS_ROW_TEXT_CLASS} htmlFor={props.htmlFor}>
					{props.label}
				</label>
			)}
		</div>
		<div className={SETTINGS_ROW_CONTROL_CLASS}>{props.children}</div>
	</div>
);

export const SettingsLabel: React.FC<{ label: React.ReactNode; description?: React.ReactNode }> = (props) => (
	<span className={SETTINGS_LABEL_COPY_CLASS}>
		<span>{props.label}</span>
		{props.description === undefined ? null : <span className={SETTINGS_HELP_TEXT_CLASS}>{props.description}</span>}
	</span>
);

export const SettingsActions: React.FC<{ children: React.ReactNode }> = (props) => (
	<span className={SETTINGS_ACTION_GROUP_CLASS}>{props.children}</span>
);

export const SettingsButtonRow: React.FC<{
	label: React.ReactNode;
	description?: React.ReactNode;
	buttonLabel: React.ReactNode;
	disabled?: boolean;
	variant?: ButtonVariant;
	onClick: () => void;
}> = (props) => (
	<SettingsRow label={<SettingsLabel label={props.label} description={props.description} />}>
		<Button variant={props.variant ?? "secondary"} disabled={props.disabled} onClick={props.onClick}>
			{props.buttonLabel}
		</Button>
	</SettingsRow>
);

export const SettingsTextInputRow: React.FC<{
	label: React.ReactNode;
	description?: React.ReactNode;
	value: string;
	placeholder?: string;
	ariaLabel?: string;
	onInput: (value: string) => void;
	actionLabel?: React.ReactNode;
	actionDisabled?: boolean;
	onAction?: () => void;
}> = (props) => (
	<SettingsRow label={<SettingsLabel label={props.label} description={props.description} />}>
		<SettingsActions>
			<TextInput
				value={props.value}
				placeholder={props.placeholder}
				ariaLabel={props.ariaLabel}
				onInput={props.onInput}
			/>
			{props.actionLabel === undefined || props.onAction === undefined ? null : (
				<Button variant="secondary" disabled={props.actionDisabled} onClick={props.onAction}>
					{props.actionLabel}
				</Button>
			)}
		</SettingsActions>
	</SettingsRow>
);

// The client's own switch structure around a native checkbox. Its semantic
// classes are recreated by the CLI css-map, so Spotify and themes style this
// exactly like the adjacent settings controls.
export const Toggle: React.FC<{
	id?: string;
	ariaLabel?: string;
	disabled?: boolean;
	value: boolean;
	onChange: (value: boolean) => void;
}> = (props) => (
	<label className={TOGGLE_CLASSES.wrapper}>
		<input
			type="checkbox"
			className={TOGGLE_CLASSES.input}
			id={props.id}
			aria-label={props.ariaLabel}
			checked={props.value}
			disabled={props.disabled}
			onKeyDown={activateToggleOnKeyDown}
			onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
		/>
		<span className={TOGGLE_CLASSES.indicatorWrapper} aria-hidden="true">
			<span className={TOGGLE_CLASSES.indicator} />
		</span>
	</label>
);

export const SettingsProviderRow: React.FC<{
	label: string;
	description?: React.ReactNode;
	value: boolean;
	disabled?: boolean;
	disabledReason?: string;
	index: number;
	total: number;
	onChange: (value: boolean) => void;
	onMove: (direction: -1 | 1) => void;
}> = (props) => {
	const id = React.useId();
	const toggle = (
		<Toggle
			id={id}
			ariaLabel={`${props.label} provider`}
			value={props.value}
			disabled={props.disabled}
			onChange={props.onChange}
		/>
	);
	return (
		<SettingsRow label={<SettingsLabel label={props.label} description={props.description} />} htmlFor={id}>
			<SettingsActions>
				<ReorderButtons
					label={props.label}
					disableUp={props.index === 0}
					disableDown={props.index === props.total - 1}
					onMove={props.onMove}
				/>
				{props.disabled && props.disabledReason ? (
					<Spicetify.ReactComponent.TooltipWrapper label={props.disabledReason}>
						{toggle}
					</Spicetify.ReactComponent.TooltipWrapper>
				) : (
					toggle
				)}
			</SettingsActions>
		</SettingsRow>
	);
};

// The "module with one boolean setting" pattern as a single row for the
// `settingsRow` register. `getValue` is read lazily on every mount so
// reopening settings always reflects the current state; the element itself
// is created once at module load, so a plain value prop would go stale.
export const SettingsToggleRow: React.FC<{
	label: React.ReactNode;
	getValue: () => boolean;
	onChange: (value: boolean) => void;
}> = (props) => {
	const id = React.useId();
	const [value, setValue] = React.useState(props.getValue);
	return (
		<SettingsRow label={props.label} htmlFor={id}>
			<Toggle
				id={id}
				value={value}
				onChange={(v) => {
					setValue(v);
					props.onChange(v);
				}}
			/>
		</SettingsRow>
	);
};

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
export const Dialog: React.FC<{
	title: string;
	onClose: () => void;
	size?: "normal" | "large";
	children: React.ReactNode;
}> = (props) => {
	const dialogRef = React.useRef<HTMLDivElement>(null);
	const onCloseRef = React.useRef(props.onClose);
	const titleId = React.useId();
	onCloseRef.current = props.onClose;
	React.useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		return activateDialog(dialog, () => onCloseRef.current());
	}, []);
	const dialogClass = props.size === "large" ? `${DIALOG_CLASS} ${DIALOG_LARGE_CLASS}` : DIALOG_CLASS;

	return ReactDOM.createPortal(
		<div
			className={SCRIM_CLASS}
			onClick={(e) => {
				if (e.target === e.currentTarget) props.onClose();
			}}
		>
			<div
				ref={dialogRef}
				className={dialogClass}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
			>
				<div className={DIALOG_HEADER_CLASS}>
					<h2 id={titleId}>{props.title}</h2>
					<IconButton ariaLabel="Close" onClick={props.onClose}>
						×
					</IconButton>
				</div>
				<div className={DIALOG_BODY_CLASS}>{props.children}</div>
			</div>
		</div>,
		document.body,
	);
};
