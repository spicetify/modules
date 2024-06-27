export { default as loadMixins } from "./mix.ts";

export default async function load() {
	const mod = await import("./mod.ts");
	const { Platform } = await import("./src/expose/Platform.ts");
	return () => {
		Platform.getPlayerAPI().getEvents().removeListener("update", mod.listener);
		mod.cancel();
	};
}
