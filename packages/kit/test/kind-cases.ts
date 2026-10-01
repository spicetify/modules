/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// metadata.json shapes every copy of the kind rule must read the same way:
// `kind` wins, `tags` is the fallback, unknown kinds are ignored.
export const KIND_CASES: Record<string, unknown>[] = [
	{},
	{ kind: "theme" },
	{ kind: "extension" },
	{ kind: "snippet" },
	{ kind: "app" },
	{ kind: "lib" },
	{ kind: "nonsense" },
	{ kind: 5, tags: ["theme"] },
	{ tags: ["theme"] },
	{ tags: ["retro", "theme", "dark"] },
	{ tags: ["snippet"] },
	{ tags: ["retro", "dark"] },
	{ tags: ["theme", "extension"] },
	{ tags: [] },
	{ tags: "theme" },
	{ tags: [1, "theme"] },
	{ kind: "extension", tags: ["theme"] },
	{ kind: "theme", tags: ["extension"] },
	{ kind: "nonsense", tags: ["theme"] },
	{ kind: "Theme" },
];
