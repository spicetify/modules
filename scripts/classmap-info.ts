export const GH_RAW_CLASSMAP_URL =
	"https://raw.githubusercontent.com/spicetify/classmaps/main/1020040/classmap-1906ea8d2e9.json";

async function parseGhRawUrl(rawUrl: string) {
	const urlMatch = rawUrl.match(
		/^https:\/\/raw\.githubusercontent\.com\/(?<owner>[^\/]+)\/(?<repo>[^\/]+)\/(?<branch>[^\/]+)\/(?<path>.+)$/,
	);
	if (!urlMatch) {
		throw new Error(`Invalid raw url: ${rawUrl}`);
	}
	const { owner, repo, branch, path } = urlMatch.groups!;

	const pathMatch = path.match(/^(?<version>\d{7})\/classmap-(?<timestamp>[0-9a-f]{11})\.json$/);
	if (!pathMatch) {
		throw new Error(`Invalid path: ${path}`);
	}
	const { version, timestamp } = pathMatch.groups!;

	return {
		classmap: await fetch(rawUrl).then((res) => res.json()),
		version: Number(version),
		timestamp: Number.parseInt(timestamp, 16),
	};
}

export const classmapInfos = [await parseGhRawUrl(GH_RAW_CLASSMAP_URL)];
