import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { watchRegistryQuiet } from "./registry-quiet.ts";

const setup = (t: TestContext) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"] });
	const state = { count: 100, pending: 0, quietAt: -1 };
	watchRegistryQuiet({
		count: () => state.count,
		pending: () => state.pending,
		onQuiet: () => (state.quietAt = Date.now()),
	});
	const advance = (ms: number) => {
		for (let i = 0; i < ms / 25; i++) t.mock.timers.tick(25);
	};
	return { state, advance };
};

test("releases once the registry has been unchanged for the quiet window", (t) => {
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
	advance(1000);
	assert.equal(state.quietAt, -1);
	state.pending = 0;
	advance(300);
	assert.equal(state.quietAt, 1300);
});

test("releases at the cap when the registry never settles", (t) => {
	const { state, advance } = setup(t);
	for (let i = 0; i < 400; i++) {
		state.count++;
		advance(25);
	}
	assert.equal(state.quietAt, 10_000);
});

test("a chunk that never finishes holds back release for at most pendingMs", (t) => {
	const { state, advance } = setup(t);
	state.pending = 1;
	advance(1975);
	assert.equal(state.quietAt, -1);
	advance(50);
	assert.equal(state.quietAt, 2025);
});
