import assert from "node:assert/strict";
import { test } from "node:test";
import { createModuleQueryClient } from "./query.ts";

test("module queries deduplicate reads and unload cancels only their own work", async () => {
	const disposers: (() => void | Promise<void>)[] = [];
	const client = createModuleQueryClient({ defer: (dispose) => disposers.push(dispose) });
	const other = createModuleQueryClient({ defer: () => {} });
	let calls = 0;
	let finish: (value: string) => void = () => {};
	let signal: AbortSignal | undefined;
	const options = {
		queryKey: ["lyrics", "track"],
		queryFn: (context: { signal: AbortSignal }) => {
			calls++;
			signal = context.signal;
			return new Promise<string>((resolve) => {
				finish = resolve;
			});
		},
	};
	const first = client.fetchQuery(options);
	const second = client.fetchQuery(options);
	const settled = Promise.allSettled([first, second]);
	assert.equal(calls, 1);
	other.setQueryData(["lyrics", "track"], "other module");
	await disposers[0]();
	assert.equal(signal?.aborted, true);
	finish("late result");
	assert.deepEqual(
		(await settled).map((result) => result.status),
		["rejected", "rejected"],
	);
	assert.equal(client.getQueryCache().getAll().length, 0);
	assert.equal(other.getQueryData(["lyrics", "track"]), "other module");
	other.clear();
});

test("module queries cache successful reads, expose failures, and retry only on another request", async () => {
	const client = createModuleQueryClient({ defer: () => {} });
	let calls = 0;
	const options = {
		queryKey: ["track"],
		queryFn: async () => {
			calls++;
			if (calls === 1) throw new Error("offline");
			return "lyrics";
		},
	};
	try {
		await assert.rejects(client.fetchQuery(options), /offline/);
		assert.equal(calls, 1);
		assert.equal(await client.fetchQuery(options), "lyrics");
		assert.equal(await client.fetchQuery(options), "lyrics");
		assert.equal(calls, 2);
	} finally {
		client.clear();
	}
});
