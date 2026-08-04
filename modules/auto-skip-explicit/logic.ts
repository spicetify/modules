/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The skip decision, client-free so it can be tested: the explicit flag
// arrives as metadata.is_explicit (a string) on normal tracks and as a
// boolean isExplicit on some queue items.
export const isExplicit = (item: any): boolean => {
	const flag = item?.metadata?.is_explicit ?? item?.isExplicit;
	return flag === "true" || flag === true;
};
