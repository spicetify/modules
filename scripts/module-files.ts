import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { contentRoots } from "../packages/kit/src/build.ts";

export function moduleFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (["node_modules", "dist", ".git"].includes(entry.name)) return [];
		const file = path.join(directory, entry.name);
		return entry.isDirectory() ? moduleFiles(file) : entry.isFile() ? [file] : [];
	});
}

export function workspaceModules(root: string): string[] {
	return contentRoots(path.join(root, "modules")).flatMap((directory) => {
		if (!existsSync(directory)) return [];
		return readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && existsSync(path.join(directory, entry.name, "metadata.json")))
			.map((entry) => path.join(directory, entry.name));
	});
}
