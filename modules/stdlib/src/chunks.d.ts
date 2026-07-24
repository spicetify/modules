// Ambient declaration for the chunk-promise table the modular loader
// maintains on globalThis; keyed by chunk path plus aliases like "xpui".
declare global {
	var CHUNKS: Record<
		string,
		{ promise: Promise<unknown>; resolve?: (value?: unknown) => void; reject?: (reason?: unknown) => void }
	>;
}

export {};
