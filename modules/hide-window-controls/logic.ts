/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Pure, client-free module logic. Keep functions here dependency-free (no
 * /modules/* or client imports) so they are unit-testable; mod.tsx passes the
 * client capabilities into them. Starter tests import this file,
 * never mod.tsx.
 */

export const STORAGE_KEY = "spicetify:hide-window-controls";

export function shouldHide(stored: string | null): boolean {
	return stored !== "0";
}
