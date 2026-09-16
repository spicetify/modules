import "../stdlib/lib/test-setup.mts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Translator } from "./translator.ts";

Object.defineProperty(globalThis, "XMLHttpRequest", { value: window.XMLHttpRequest, configurable: true });

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
