import type { ModuleInstance, Transformer } from "/hooks/index.ts";

export async function mixin(transformer: Transformer) {
	return await (await import("./mix.ts")).default(transformer);
}

export async function load(mod: ModuleInstance) {
	return await (await import("./mod.ts")).default(mod);
}
