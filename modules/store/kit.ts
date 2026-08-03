/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Type-only import (erased at build): the kit is loaded at runtime via a
// dynamic import in the enhanced path only, so the standalone fallback
// keeps working even when stdlib is absent (the store declares no hard
// dependency on it, by design — learnings 26/27).
import type * as UIKit from "/modules/stdlib/lib/primitives-vanilla.ts";

export let Badge: typeof UIKit.Badge;
export let Button: typeof UIKit.Button;
export let Chip: typeof UIKit.Chip;
export let openDialog: typeof UIKit.openDialog;
export let Select: typeof UIKit.Select;
export let Textarea: typeof UIKit.Textarea;
export let TextInput: typeof UIKit.TextInput;

export async function loadKit(): Promise<void> {
	({ Badge, Button, Chip, openDialog, Select, Textarea, TextInput } =
		await import("/modules/stdlib/lib/primitives-vanilla.js"));
}
