/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import path from "node:path";

import { genClassMapDts } from "jsr:@delu/tailor";

const classmapPath = "classmap.json";
console.log(`Using classmap from ${classmapPath}`);
const classmap = JSON.parse(await Deno.readTextFile(classmapPath));

for await (const module of Deno.readDir("modules")) {
	if (!module.isDirectory) {
		continue;
	}

	const classmapDts = genClassMapDts(classmap);
	const classmapDtsPath = path.join("modules", module.name, "classmap.d.ts");
	await Deno.writeTextFile(classmapDtsPath, classmapDts);
	console.log(`Generated ${classmapDtsPath}`);
}
