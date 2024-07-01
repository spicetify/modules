import build from "./build-shared.ts";

async function parseGhRawUrl(rawUrl: string) {
	const urlMatch = rawUrl.match(/^https:\/\/raw\.githubusercontent\.com\/(?<owner>[^\/]+)\/(?<repo>[^\/]+)\/(?<branch>[^\/]+)\/(?<path>.+)$/);
	if (!urlMatch) {
		throw new Error(`Invalid raw url: ${rawUrl}`);
	}
	const { owner, repo, branch, path } = urlMatch.groups!;

	const pathMatch = path.match(/^(?<version>\d{7})\/classmap-(?<timestamp>[0-9a-f]{11})\.json$/);
	if (!pathMatch) {
		throw new Error(`Invalid path: ${path}`);
	}
	const { version, timestamp } = pathMatch.groups!;

	const versionSemver = `${version[0]}.${version.slice(1, 3)}.${version.slice(3, 7)}`;
	const timestampDecimal = Number.parseInt(timestamp, 16);

	return {
		classmap: await fetch(rawUrl).then(res => res.json()),
		version: versionSemver,
		timestamp: timestampDecimal,
	};
}

const GH_RAW_CLASSMAP_URL = "https://raw.githubusercontent.com/spicetify/classmaps/main/1020040/classmap-1906ea8d2e9.json";

const classmapInfos = [await parseGhRawUrl(GH_RAW_CLASSMAP_URL)];

await build(classmapInfos, Deno.args);
