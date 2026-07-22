/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ClassmapInfo = {
	classmap: any;
	version: number;
	timestamp: number;
};

async function loadLocalClassmap(path: string): Promise<ClassmapInfo> {
	const m = path.match(/(?<version>\d{7})\/classmap-(?<timestamp>[0-9a-f]{11,})\.json$/);
	if (!m?.groups) throw new Error(`Invalid classmap path: ${path}`);
	return {
		classmap: JSON.parse(await Deno.readTextFile(path)),
		version: Number(m.groups.version),
		timestamp: Number.parseInt(m.groups.timestamp, 16),
	};
}

export const classmapInfos: ClassmapInfo[] = await Promise.all([
	loadLocalClassmap("../classmaps/1020092/classmap-19f8522e902.json"),
	loadLocalClassmap("../classmaps/1020094/classmap-19f856aefd5.json"),
]);
