import "../stdlib/lib/test-setup.mts";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Translator } from "./translator.ts";

Object.defineProperty(globalThis, "XMLHttpRequest", { value: window.XMLHttpRequest, configurable: true });

function setupLoading(t: TestContext) {
	t.mock.method(Translator.prototype, "applyKuromojiFix", () => {});
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const scheduled = t.mock.method(globalThis, "setTimeout");
	const cleared = t.mock.method(globalThis, "clearTimeout");
	const scripts: HTMLScriptElement[] = [];
	// Keep downloads entirely offline and dispatch their browser events explicitly.
	t.mock.method(document.head, "appendChild", (node: HTMLScriptElement) => {
		scripts.push(node);
		return node;
	});
	t.after(() => {
		for (const key of ["Kuroshiro", "KuromojiAnalyzer", "Aromanize", "OpenCC"]) {
			Reflect.deleteProperty(globalThis, key);
		}
	});
	return {
		scripts,
		assertNoTimers: () => assert.equal(cleared.mock.callCount(), scheduled.mock.callCount()),
	};
}

test("missing downloads time out, release timers, and can retry", async (t) => {
	const { scripts, assertNoTimers } = setupLoading(t);
	const translator = new Translator("ko", true, { timeoutMs: 25 });
	const failure = assert.rejects(translator.awaitFinished("ko"), /timed out/i);
	t.mock.timers.tick(25);
	await failure;
	assertNoTimers();
	Object.defineProperty(globalThis, "Aromanize", {
		value: { hangulToLatin: (text: string) => `latin:${text}` },
		configurable: true,
	});
	assert.equal(await translator.convertToRomaja("가", "romaji"), "latin:가");
	assert.equal(await translator.convertToRomaja("가", "hangul"), "가");
	assert.equal(scripts.length, 1);
	translator.dispose();
	assertNoTimers();
});

test("download errors reject promptly and retry inserts a fresh script", async (t) => {
	const { scripts, assertNoTimers } = setupLoading(t);
	const translator = new Translator("zh", true, { timeoutMs: 25 });
	const failure = assert.rejects(translator.awaitFinished("zh"), /load/i);
	scripts[0].dispatchEvent(new Event("error"));
	await failure;
	const ready = translator.awaitFinished("zh");
	assert.equal(scripts.length, 2);
	Object.defineProperty(globalThis, "OpenCC", {
		value: {
			Converter:
				({ from, to }: { from: string; to: string }) =>
				(text: string) =>
					`${from}:${to}:${text}`,
		},
		configurable: true,
	});
	scripts[1].dispatchEvent(new Event("load"));
	await ready;
	assert.equal(await translator.convertChinese("字", "t", "cn"), "t:cn:字");
	translator.dispose();
	assertNoTimers();
});

test("Japanese dictionary rejection is observed and the next attempt can succeed", async (t) => {
	const { assertNoTimers } = setupLoading(t);
	let attempts = 0;
	Object.defineProperty(globalThis, "KuromojiAnalyzer", { value: class {}, configurable: true });
	Object.defineProperty(globalThis, "Kuroshiro", {
		value: {
			default: class {
				async init() {
					if (++attempts === 1) throw new Error("dictionary unavailable");
				}
				async convert(text: string, { to, mode }: { to: string; mode: string }) {
					return `${to}:${mode}:${text}`;
				}
			},
		},
		configurable: true,
	});
	const translator = new Translator("ja", true, { timeoutMs: 25 });
	await assert.rejects(translator.awaitFinished("ja"), /dictionary unavailable/);
	assert.equal(await translator.romajifyText("字"), "romaji:spaced:字");
	assert.equal(attempts, 2);
	translator.dispose();
	assertNoTimers();
});

test("a loaded script without its library rejects and can be downloaded again", async (t) => {
	const { scripts, assertNoTimers } = setupLoading(t);
	const translator = new Translator("ko", true, { timeoutMs: 25 });
	const failed = assert.rejects(translator.awaitFinished("ko"), /did not load/);
	scripts[0].dispatchEvent(new Event("load"));
	await failed;
	const ready = translator.awaitFinished("ko");
	assert.equal(scripts.length, 2);
	Object.defineProperty(globalThis, "Aromanize", {
		value: { hangulToLatin: (text: string) => text },
		configurable: true,
	});
	scripts[1].dispatchEvent(new Event("load"));
	await ready;
	translator.dispose();
	assertNoTimers();
});

test("a stalled dictionary is bounded and late completion cannot resurrect disposed state", async (t) => {
	const { assertNoTimers } = setupLoading(t);
	let finish: () => void = () => {};
	let started = false;
	Object.defineProperty(globalThis, "KuromojiAnalyzer", { value: class {}, configurable: true });
	Object.defineProperty(globalThis, "Kuroshiro", {
		value: {
			default: class {
				init() {
					started = true;
					return new Promise<void>((resolve) => {
						finish = resolve;
					});
				}
				async convert(text: string) {
					return text;
				}
			},
		},
		configurable: true,
	});
	const translator = new Translator("ja", true, { timeoutMs: 25 });
	const failure = assert.rejects(translator.awaitFinished("ja"), /timed out/i);
	for (let i = 0; i < 5; i++) await Promise.resolve();
	assert.equal(started, true);
	t.mock.timers.tick(25);
	await failure;
	translator.dispose();
	finish();
	await assert.rejects(translator.romajifyText("字"), { name: "AbortError" });
	assertNoTimers();
});

test("a stalled Japanese conversion times out and disposal cancels another conversion", async (t) => {
	const { assertNoTimers } = setupLoading(t);
	let started = 0;
	Object.defineProperty(globalThis, "KuromojiAnalyzer", { value: class {}, configurable: true });
	Object.defineProperty(globalThis, "Kuroshiro", {
		value: {
			default: class {
				async init() {}
				convert() {
					started++;
					return new Promise<string>(() => {});
				}
			},
		},
		configurable: true,
	});
	const translator = new Translator("ja", true, { timeoutMs: 25 });
	await translator.awaitFinished("ja");
	const timeout = assert.rejects(translator.romajifyText("字"), /timed out/i);
	await Promise.resolve();
	assert.equal(started, 1);
	t.mock.timers.tick(25);
	await timeout;
	const disposed = assert.rejects(translator.romajifyText("字"), { name: "AbortError" });
	await Promise.resolve();
	assert.equal(started, 2);
	translator.dispose();
	await disposed;
	assertNoTimers();
});

test("dispose cancels all waiters and removes pending script listeners and timers", async (t) => {
	const { scripts, assertNoTimers } = setupLoading(t);
	const translator = new Translator("ko", true, { timeoutMs: 25 });
	const waits = [translator.awaitFinished("ko"), translator.convertChinese("字", "t", "cn")];
	const failures = waits.map((wait) => assert.rejects(wait, { name: "AbortError" }));
	translator.dispose();
	translator.dispose();
	await Promise.all(failures);
	for (const script of scripts) script.dispatchEvent(new Event("load"));
	await assert.rejects(translator.awaitFinished("ko"), { name: "AbortError" });
	assertNoTimers();
});

test("dictionary URL patch preserves normal XHR arguments and installs once", (t) => {
	const calls: Array<{
		method: string;
		url: string | URL;
		async: boolean;
		username?: string | null;
		password?: string | null;
	}> = [];
	t.mock.method(
		XMLHttpRequest.prototype,
		"open",
		function (method: string, url: string | URL, async = true, username?: string | null, password?: string | null) {
			calls.push({ method, url, async, username, password });
		},
	);
	t.after(() => {
		delete XMLHttpRequest.prototype.realOpen;
	});
	Translator.prototype.applyKuromojiFix();
	const patched = XMLHttpRequest.prototype.open;
	Translator.prototype.applyKuromojiFix();
	assert.equal(XMLHttpRequest.prototype.open, patched);
	const request = new XMLHttpRequest();
	request.open("GET", "https:/cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/base.dat.gz");
	assert.equal(calls[0].url, "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/base.dat.gz");
	assert.equal(calls[0].async, true);
	const url = new URL("https://example.com/lyrics");
	request.open("POST", url, false, "user", "password");
	assert.deepEqual(calls[1], { method: "POST", url, async: false, username: "user", password: "password" });
});
