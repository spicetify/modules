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
export const SELECT_CLASS = "spicetify-select";
export const SEARCHBAR_CLASS = "spicetify-searchbar";
export const CARD_CLASS = "spicetify-card";
export const SCRIM_CLASS = "spicetify-scrim";
export const DIALOG_CLASS = "spicetify-dialog";
export const DIALOG_HEADER_CLASS = "spicetify-dialog-header";
export const DIALOG_BODY_CLASS = "spicetify-dialog-body";
