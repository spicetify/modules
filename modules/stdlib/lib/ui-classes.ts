/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The single source of truth for the module chrome-class contract. Both
 * the vanilla kit (ui.ts) and the React kit (ui-react.tsx) apply these,
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
