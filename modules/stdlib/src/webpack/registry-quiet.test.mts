import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { watchRegistryQuiet } from "./registry-quiet.ts";

const setup = (t: TestContext) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"] });
	const state = { count: 100, pending: 0, quietAt: -1 };
	watchRegistryQuiet(
		() => state.count,
		() => state.pending,
		() => (state.quietAt = Date.now()),
	);
	const advance = (ms: number) => {
		for (let i = 0; i < ms / 25; i++) t.mock.timers.tick(25);
	};
	return { state, advance };
};

test("releases once the registry has been unchanged for 300ms", (t) => {
	const { state, advance } = setup(t);
	advance(200);
	state.count = 150;
	advance(275);
	assert.equal(state.quietAt, -1);
	advance(50);
	assert.equal(state.quietAt, 525);
});

test("never releases while a chunk load is in flight, even with no new modules", (t) => {
	const { state, advance } = setup(t);
	state.pending = 1;
	advance(5000);
	assert.equal(state.quietAt, -1);
	state.pending = 0;
	advance(300);
	assert.equal(state.quietAt, 5300);
});

test("releases at the 10s cap when a chunk never finishes", (t) => {
	const { state, advance } = setup(t);
	state.pending = 1;
	advance(9975);
	assert.equal(state.quietAt, -1);
	advance(25);
	assert.equal(state.quietAt, 10_000);
});
