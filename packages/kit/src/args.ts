/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// flagValue returns the operand of --<name>, undefined when the flag is
// absent, and throws when the flag is present without an operand.
export function flagValue(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(`--${name}`);
	if (i < 0) return undefined;
	const value = argv[i + 1];
	if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
	return value;
}
