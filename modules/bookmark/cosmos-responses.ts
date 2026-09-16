function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Invalid bookmark metadata response");
	}
	return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string {
	if (typeof value !== "string") throw new Error("Invalid bookmark metadata text");
	return value;
}

function first(value: unknown): Record<string, unknown> {
	if (!Array.isArray(value)) throw new Error("Invalid bookmark metadata list");
	return record(value[0]);
}

export function parseShowMetadata(value: unknown) {
	const metadata = record(record(record(value).header).showMetadata);
	return {
		title: text(metadata.name),
		description: "Podcast",
		imageUrl: text(record(metadata.covers).standardLink),
	};
}

export function parseTrackMetadata(value: unknown) {
	const metadata = record(value);
	return {
		title: text(metadata.name),
		description: text(first(metadata.artists).name),
		imageUrl: text(first(record(metadata.album).images).url),
	};
}

export function parseEpisodeMetadata(value: unknown) {
	const metadata = record(value);
	const show = record(metadata.show);
	return {
		title: text(metadata.name),
		description: `${text(show.name)} episode`,
		imageUrl: text(first(show.images).url),
	};
}

export function parsePlaylistMetadata(value: unknown) {
	const metadata = record(record(value).metadata);
	return {
		title: text(metadata.name),
		description: "Playlist",
		imageUrl: metadata.picture == null ? undefined : text(metadata.picture),
	};
}
