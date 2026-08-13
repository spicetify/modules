/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The single source of truth for the module chrome-class contract. Both
 * the vanilla kit (ui.ts) and the React primitives (primitives.tsx) apply these,
 * so the two tiers can never drift on which class means which primitive.
 * The classes themselves live in stdlib's stylesheet (index.scss).
 */

export type ButtonVariant = "primary" | "secondary" | "danger";
export type BadgeTone = "neutral" | "ok" | "bad";

export const buttonClass = (variant: ButtonVariant = "primary"): string =>
	variant === "primary" ? "spicetify-button" : `spicetify-button spicetify-button--${variant}`;

export const badgeClass = (tone: BadgeTone = "neutral"): string =>
	tone === "neutral" ? "spicetify-badge" : `spicetify-badge spicetify-badge--${tone}`;

export const chipClass = (active: boolean): string =>
	active ? "spicetify-chip spicetify-chip--active" : "spicetify-chip";

export const ICON_BUTTON_CLASS = "spicetify-button-circle";
// A row in one of Spotify's own context menus. Unlike the spicetify-*
// classes above (ours, styled in index.scss), this is Spotify's stable
// semantic class — the kit owns it in this one place so module code never
// has to name a client class to get a native-looking menu item.
export const MENU_ITEM_CLASS = "main-contextMenu-menuItemButton";
export const SELECT_CLASS = "spicetify-select";
export const SEARCHBAR_CLASS = "spicetify-searchbar";
export const CARD_CLASS = "spicetify-card";
export const SCRIM_CLASS = "spicetify-scrim";
export const DIALOG_CLASS = "spicetify-dialog";
export const DIALOG_HEADER_CLASS = "spicetify-dialog-header";
export const DIALOG_BODY_CLASS = "spicetify-dialog-body";

// The client's own settings chrome. These names exist because the CLI's
// css-map recreates them, so a module row is styled by Spotify's own CSS
// instead of approximating it.
export const SETTINGS_SECTION_CLASS = "x-settings-section";
export const SETTINGS_ROW_CLASS = "x-settings-row";
export const SETTINGS_ROW_LABEL_CLASS = "x-settings-firstColumn";
export const SETTINGS_ROW_CONTROL_CLASS = "x-settings-secondColumn";
export const SETTINGS_ACTION_GROUP_CLASS = "spicetify-settings-actions";
export const SETTINGS_LABEL_COPY_CLASS = "spicetify-settings-label-copy";
export const SETTINGS_HEADER_CONTAINER_CLASS = "x-settings-headerContainer";
export const SETTINGS_HEADER_CLASS =
	"encore-text encore-text-title-medium encore-internal-color-text-base x-settings-header";
export const SETTINGS_SECTION_HEADING_CLASS =
	"encore-text encore-text-body-medium-bold encore-internal-color-text-base spicetify-settings-section-heading";
export const SETTINGS_SECTION_SUBHEADING_CLASS =
	"encore-text encore-text-body-medium-bold encore-internal-color-text-base spicetify-settings-section-subheading";
export const SETTINGS_ROW_TEXT_CLASS = "encore-text encore-text-body-small encore-internal-color-text-subdued";
export const SETTINGS_HELP_TEXT_CLASS = "encore-text encore-text-marginal encore-internal-color-text-subdued";
export const TOGGLE_CLASSES = {
	wrapper: "x-toggle-wrapper",
	input: "x-toggle-input",
	indicatorWrapper: "x-toggle-indicatorWrapper",
	indicator: "x-toggle-indicator",
} as const;

/** @deprecated Use TOGGLE_CLASSES with the native switch structure. */
export const TOGGLE_CLASS = "spicetify-toggle";

export function activateToggleOnKeyDown(event: {
	key: string;
	currentTarget: { click: () => void };
	preventDefault: () => void;
	stopPropagation: () => void;
}): void {
	if (event.key !== " " && event.key !== "Enter") return;
	event.preventDefault();
	event.stopPropagation();
	event.currentTarget.click();
}
