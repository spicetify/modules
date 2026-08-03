/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Prebundled vendor copy (one self-contained file; vendor/rxjs.d.ts carries
// the types), so stdlib boots without the network. The esm.sh imports this
// replaces were static, which put esm.sh in every client's boot path and
// made an offline boot fail the whole module graph. A bare "rxjs" import is
// no good either: the tree build preserves modules, so it splats the package
// into dist as dozens of files under the resolver's store path.
export { BehaviorSubject, Subject, Subscription } from "./vendor/rxjs.js";

// The one remaining lodash consumer is startCase; a local implementation
// beats shipping lodash for it. Splits camelCase and non-alphanumeric
// boundaries, capitalizes each word ("miserly-magenta" -> "Miserly Magenta").
export const startCase = (value: string): string =>
	value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
