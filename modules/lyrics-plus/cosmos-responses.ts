export function responseRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

export function vibrantColor(value: unknown): number {
	const entries = responseRecord(value).entries;
	const swatches = Array.isArray(entries) ? responseRecord(entries[0]).color_swatches : undefined;
	const swatch = Array.isArray(swatches)
		? swatches.map(responseRecord).find((color) => color.preset === "VIBRANT_NON_ALARMING")
		: undefined;
	return typeof swatch?.color === "number" && Number.isFinite(swatch.color) ? swatch.color : 8747370;
}

export function trackTempo(value: unknown): number {
	const tempo = responseRecord(value).tempo;
	return typeof tempo === "number" && Number.isFinite(tempo) && tempo > 0 ? tempo : 105;
}

export function tokenResponse(value: unknown): { status: number; token?: string } {
	const message = responseRecord(responseRecord(value).message);
	const status = responseRecord(message.header).status_code;
	const token = responseRecord(message.body).user_token;
	return {
		status: typeof status === "number" ? status : 0,
		token: typeof token === "string" && token && !token.startsWith("UpgradeOnly") ? token : undefined,
	};
}
