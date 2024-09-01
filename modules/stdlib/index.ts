import { IndexLoadFn, IndexMixinFn } from "/hooks/module.ts";

export const mixin: IndexMixinFn = async (context) => {
	return await (await import("./mix.ts")).default(context.transformer);
};

export const load: IndexLoadFn = async (context) => {
	return await (await import("./mod.ts")).default(context.module);
};
