/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Pure ordering used by the register mount render. Kept free of any client
// (React/DOM) imports so it can be unit-tested in Node.

interface Orderable {
	props?: { order?: number };
}

// Stable ascending sort by an optional numeric `order` prop carried on a
// registered element (lower renders earlier). Items without one are treated
// as order 0 and keep their registration order; equal orders fall back to it
// too. This backs registrar.placeButton(..., { order }); plain register()
// items are all order-0 and so keep insertion order, unchanged.
export const byOrder = <T extends Orderable>(items: T[]): T[] =>
	items
		.map((item, i) => [item, i] as const)
		.sort(([a, ai], [b, bi]) => (a?.props?.order ?? 0) - (b?.props?.order ?? 0) || ai - bi)
		.map(([item]) => item);
