export { default as mixin } from "./mix.ts";

export default async function load() {
	const { historyListener, playerListener } = await import("./mod.ts");
	const { Platform } = await import("./src/expose/Platform.ts");
	const cancelPlayerListener = Platform.getPlayerAPI().getEvents().addListener("update", playerListener);
	const cancelHistoryListener = Platform.getHistory().listen(historyListener);
	return () => {
		cancelPlayerListener();
		cancelHistoryListener();
	};
}
