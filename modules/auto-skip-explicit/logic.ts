/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The skip decision, client-free so it can be tested: the explicit flag
// arrives as metadata.is_explicit (a string) on normal tracks and as a
// boolean isExplicit on some queue items.
export const isExplicit = (item: unknown): boolean => {
	if (typeof item !== "object" || item === null) return false;
	const metadata = "metadata" in item ? item.metadata : undefined;
	const metadataFlag =
		typeof metadata === "object" && metadata !== null && "is_explicit" in metadata
			? metadata.is_explicit
			: undefined;
	const flag = metadataFlag ?? ("isExplicit" in item ? item.isExplicit : undefined);
	return flag === "true" || flag === true;
};
