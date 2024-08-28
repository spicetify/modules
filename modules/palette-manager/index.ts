import type { ModuleInstance } from "/hooks/index.ts";

export async function preload(mod: ModuleInstance) {
	return (await import("./palette.ts")).default(mod);
}

export async function load(mod: ModuleInstance) {
	return await (await import("./mod.tsx")).default(mod);
}
