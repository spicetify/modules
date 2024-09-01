import { IndexLoadFn, IndexPreloadFn } from "/hooks/module.ts";

export const preload: IndexPreloadFn = async (context) => {
	return await (await import("./palette.ts")).default(context.module);
};

export const load: IndexLoadFn = async (context) => {
	return await (await import("./mod.tsx")).default(context.module);
};
