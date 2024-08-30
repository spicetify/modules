import { IndexLoadFn, IndexPreloadFn } from "/hooks/module.ts";

export const preload: IndexPreloadFn = async (tr) => {
	return await (await import("./palette.ts")).default(tr);
};

export const load: IndexLoadFn = async (mod) => {
	return await (await import("./mod.tsx")).default(mod);
};
