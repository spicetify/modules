function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Invalid shuffle response");
	}
	return Object.fromEntries(Object.entries(value));
}

function playableLink(playable: unknown, link: unknown): string[] {
	if (playable === false || playable === undefined) return [];
	if (playable !== true || typeof link !== "string" || !link) throw new Error("Invalid shuffle track");
	return [link];
}

export function parseArtistLikedTracks(value: unknown): string[] {
	const items = record(value).item;
	if (items === undefined || items === null) return [];
	if (!Array.isArray(items)) throw new Error("Invalid shuffle track list");
	return items.flatMap((item: unknown) => {
		const track = record(record(item).trackMetadata);
		return playableLink(track.playable, track.link);
	});
}

export function parseShowEpisodes(value: unknown): string[] {
	const items = record(value).items;
	if (!Array.isArray(items)) throw new Error("Invalid shuffle episode list");
	return items.flatMap((item: unknown) => {
		const episode = record(item);
		const playable = record(episode.episodePlayState).isPlayable;
		if (playable === false || playable === undefined) return [];
		return playableLink(playable, record(episode.episodeMetadata).link);
	});
}
