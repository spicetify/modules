import { IndexLoadFn, IndexMixinFn } from "/hooks/module.ts";

export const mixin: IndexMixinFn = async (tr) => {
	return await (await import("./mix.ts")).default(tr);
};

export const load: IndexLoadFn = async (mod) => {
	return await (await import("./mod.ts")).default(mod);
};
