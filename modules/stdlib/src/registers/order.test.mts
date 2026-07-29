/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { byOrder } from "./order.ts";

const el = (id: string, order?: number) => ({ id, props: order === undefined ? {} : { order } });
const ids = (items: { id: string }[]) => items.map((i) => i.id);

test("byOrder: items without an order keep registration order", () => {
	const items = [el("a"), el("b"), el("c")];
	assert.deepEqual(ids(byOrder(items)), ["a", "b", "c"]);
});

test("byOrder: lower order renders earlier", () => {
	const items = [el("a", 10), el("b", 0), el("c", 5)];
	assert.deepEqual(ids(byOrder(items)), ["b", "c", "a"]);
});

test("byOrder: equal orders fall back to registration order (stable)", () => {
	const items = [el("a", 5), el("b", 5), el("c", 5)];
	assert.deepEqual(ids(byOrder(items)), ["a", "b", "c"]);
});

test("byOrder: missing order counts as 0 and mixes with explicit orders", () => {
	// b has no order (=> 0), so it sorts before a(1); c(-1) sorts before both.
	const items = [el("a", 1), el("b"), el("c", -1)];
	assert.deepEqual(ids(byOrder(items)), ["c", "b", "a"]);
});

test("byOrder: an explicitly negative order can precede default-0 items", () => {
	const items = [el("first"), el("promoted", -5), el("second")];
	assert.deepEqual(ids(byOrder(items)), ["promoted", "first", "second"]);
});
