/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { flagValue } from "../src/args.ts";

test("flagValue: returns the operand, undefined when absent, and rejects a missing operand", () => {
	assert.equal(flagValue(["dev", ".", "--port", "9230"], "port"), "9230");
	assert.equal(flagValue(["dev", "."], "port"), undefined);
	assert.throws(() => flagValue(["dev", ".", "--port"], "port"), /--port needs a value/);
	assert.throws(() => flagValue(["dev", "--port", "--keep"], "port"), /--port needs a value/);
});
