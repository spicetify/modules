/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "new-releases" custom
 * app by khanhas. Like the original it builds the feed from the releases of
 * the artists you follow (LibraryAPI + the client's own GraphQL discography
 * query), grouped by release day. That native path is reliable, unlike the
 * public browse Web API a v3 module cannot proxy dependably.
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { NavLink } from "/modules/stdlib/src/registers/navlink.tsx";
import { Button, Chip, IconButton, Select } from "/modules/stdlib/lib/primitives.js";

const Spicetify = (globalThis as { Spicetify?: any }).Spicetify;
const ROUTE = "/bespoke/new-releases";
const ICON = '<path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="currentColor"/>';

const DAY_MS = 24 * 3600 * 1000;

interface Release {
	uri: string;
	title: string;
	artist: { name: string; uri: string };
	imageUrl: string;
	time: number;
	type: string;
	trackCount: number;
}

// ---------- persisted config (same keys as the classic app) ----------

type ReleaseType = "album" | "single-ep" | "compilation";

const readBool = (key: string, fallback: boolean): boolean => {
	const raw = globalThis.localStorage?.getItem(`new-releases:${key}`);
	return raw === null || raw === undefined ? fallback : raw === "true";
};
const writeConfig = (key: string, value: string): void => globalThis.localStorage?.setItem(`new-releases:${key}`, value);

interface Config {
	range: number;
	relative: boolean;
	showType: boolean;
	showCount: boolean;
	album: boolean;
	singleEp: boolean;
	compilations: boolean;
}

const readConfig = (): Config => ({
	range: Number.parseInt(globalThis.localStorage?.getItem("new-releases:range") ?? "30", 10) || 30,
	relative: readBool("relative", false),
	showType: readBool("visual:type", true),
	showCount: readBool("visual:count", true),
	album: readBool("album", true),
	singleEp: readBool("single-ep", true),
	compilations: readBool("compilations", false),
});

// ---------- dismissed set (persisted) ----------

const readDismissed = (): string[] => {
	try {
		const parsed = JSON.parse(globalThis.localStorage?.getItem("new-releases:dismissed") ?? "[]");
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};
const writeDismissed = (list: string[]): void =>
	globalThis.localStorage?.setItem("new-releases:dismissed", JSON.stringify(list));

// ---------- native data path ----------

// spotify:image:HASH is not a browser-loadable URL; map it to the CDN. The
// GraphQL coverArt sources are already http(s) URLs.
const artUrl = (raw?: string): string =>
	raw?.startsWith("spotify:image:") ? `https://i.scdn.co/image/${raw.slice("spotify:image:".length)}` : raw ?? "";

const largestCover = (sources?: Array<{ url: string; width?: number }>): string => {
	if (!sources?.length) return "";
	const best = sources.reduce((prev, curr) => ((prev.width ?? 0) > (curr.width ?? 0) ? prev : curr));
	return artUrl(best.url);
};

// The artists the user follows (LibraryAPI content filtered to artists).
async function getFollowedArtists(): Promise<Array<{ name: string; uri: string }>> {
	const res = await Spicetify?.Platform?.LibraryAPI?.getContents?.({
		filters: ["1"],
		sortOrder: ["0"],
		textFilter: "",
		offset: 0,
		limit: 50000,
	});
	return res?.items ?? [];
}

// One artist's discography via the client's own persisted GraphQL query, kept
// to releases inside the window and to the enabled types.
async function getArtistReleases(
	artist: { name: string; uri: string },
	cfg: Config,
	cutoff: number,
): Promise<Release[]> {
	const def = Spicetify?.GraphQL?.Definitions?.queryArtistDiscographyAll ?? {
		name: "queryArtistDiscographyAll",
		operation: "query",
		sha256Hash: "9380995a9d4663cbcb5113fef3c6aabf70ae6d407ba61793fd01e2a1dd6929b0",
		value: null,
	};
	const { data, errors } = await Spicetify.GraphQL.Request(def, { uri: artist.uri, offset: 0, limit: 100 });
	if (errors) throw errors;

	const raw = data?.artistUnion?.discography?.all?.items?.flatMap((r: any) => r.releases?.items ?? []) ?? [];
	const typeLabel = (t: string): string | null => {
		if (t === "ALBUM") return cfg.album ? "Album" : null;
		if (t === "SINGLE" || t === "EP") return cfg.singleEp ? "Single/EP" : null;
		if (t === "COMPILATION") return cfg.compilations ? "Compilation" : null;
		return null;
	};

	const out: Release[] = [];
	for (const rel of raw) {
		const label = typeLabel(rel.type);
		if (!label) continue;
		const time = Date.parse(rel.date?.isoString ?? "");
		if (Number.isNaN(time) || time < cutoff) continue;
		out.push({
			uri: rel.uri,
			title: rel.name,
			artist: { name: artist.name, uri: artist.uri },
			imageUrl: largestCover(rel.coverArt?.sources),
			time,
			type: label,
			trackCount: rel.tracks?.totalCount ?? 0,
		});
	}
	return out;
}

// Bounded-concurrency map so following hundreds of artists does not fire
// hundreds of requests at once; failures degrade to an empty contribution.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R[]>): Promise<R[]> {
	const out: R[] = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const item = items[cursor++];
			try {
				out.push(...(await fn(item)));
			} catch {
				/* one artist failing must not sink the feed */
			}
		}
	});
	await Promise.all(workers);
	return out;
}

async function fetchReleases(cfg: Config): Promise<Release[]> {
	const artists = await getFollowedArtists();
	const cutoff = Date.now() - cfg.range * DAY_MS;
	const releases = await mapPool(artists, 16, (a) => getArtistReleases(a, cfg, cutoff));
	// A release can surface under several followed artists; keep the first.
	const seen = new Set<string>();
	const deduped = releases.filter((r) => (seen.has(r.uri) ? false : (seen.add(r.uri), true)));
	return deduped.sort((a, b) => b.time - a.time);
}

// ---------- date grouping ----------

interface Group {
	label: string;
	items: Release[];
}

function groupByDay(items: Release[], cfg: Config): Group[] {
	const locale = globalThis.localStorage?.getItem("new-releases:locale") || navigator.language;
	const abs = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit" });
	const rel = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	const startOfToday = new Date().setHours(0, 0, 0, 0);

	const labelFor = (time: number): string => {
		if (!cfg.relative) return abs.format(time);
		const days = Math.round((new Date(time).setHours(0, 0, 0, 0) - startOfToday) / DAY_MS);
		return rel.format(days, "day");
	};

	const groups: Group[] = [];
	let current: Group | undefined;
	for (const item of items) {
		const label = labelFor(item.time);
		if (!current || current.label !== label) {
			current = { label, items: [] };
			groups.push(current);
		}
		current.items.push(item);
	}
	return groups;
}

// ---------- navigation helpers ----------

const uriToPath = (uri: string): string => {
	try {
		return Spicetify?.URI?.fromString?.(uri)?.toURLPath?.(true) ?? "";
	} catch {
		return "";
	}
};
const navigate = (uri: string): void => {
	const path = uriToPath(uri);
	if (path) Spicetify?.Platform?.History?.push?.(path);
};

// ---------- card ----------

const PlayIcon = () => (
	<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
		<path d="M8 5v14l11-7z" fill="currentColor" />
	</svg>
);
const CloseIcon = () => (
	<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
		<path
			d="M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06Z"
			fill="currentColor"
			fillRule="evenodd"
		/>
	</svg>
);

const ReleaseCard = ({ release, cfg, onDismiss }: { release: Release; cfg: Config; onDismiss: (uri: string) => void }) => {
	const detail: string[] = [];
	if (cfg.showType && release.type) detail.push(release.type);
	if (cfg.showCount && release.trackCount) {
		detail.push(`${release.trackCount} ${release.trackCount === 1 ? "song" : "songs"}`);
	}
	return (
		<div className="new-releases-card" onClick={() => navigate(release.uri)}>
			<div className="new-releases-cover-wrap">
				{release.imageUrl
					? <img className="new-releases-cover" src={release.imageUrl} alt="" loading="lazy" />
					: <div className="new-releases-cover new-releases-cover--empty" />}
				<button
					type="button"
					className="new-releases-play"
					aria-label={`Play ${release.title}`}
					onClick={(e) => {
						e.stopPropagation();
						Spicetify?.Player?.playUri?.(release.uri);
					}}
				>
					<PlayIcon />
				</button>
				<button
					type="button"
					className="new-releases-dismiss"
					aria-label={`Dismiss ${release.title}`}
					onClick={(e) => {
						e.stopPropagation();
						onDismiss(release.uri);
					}}
				>
					<CloseIcon />
				</button>
			</div>
			<div className="new-releases-meta">
				<span className="new-releases-name" title={release.title}>{release.title}</span>
				{detail.length > 0 && <span className="new-releases-detail">{detail.join(" • ")}</span>}
				<span
					className="new-releases-artist"
					title={release.artist.name}
					onClick={(e) => {
						e.stopPropagation();
						navigate(release.artist.uri);
					}}
				>
					{release.artist.name}
				</span>
			</div>
		</div>
	);
};

// ---------- page ----------

type Status = "loading" | "ready" | "empty";

const Page = () => {
	const [status, setStatus] = React.useState<Status>("loading");
	const [releases, setReleases] = React.useState<Release[]>([]);
	const [dismissed, setDismissed] = React.useState<string[]>(readDismissed);
	const [cfg, setCfg] = React.useState<Config>(readConfig);

	// Each load claims a sequence number so a newer load (a refresh, a config
	// change, or a remount) supersedes an in-flight one and only the latest
	// result lands. A setState after unmount is a harmless no-op in React 18.
	const gen = React.useRef(0);
	const load = React.useCallback(async (config: Config) => {
		const seq = ++gen.current;
		setStatus("loading");
		let list: Release[] = [];
		try {
			list = await fetchReleases(config);
		} catch {
			list = [];
		}
		if (seq !== gen.current) return;
		setReleases(list);
		setStatus(list.length ? "ready" : "empty");
	}, []);

	React.useEffect(() => {
		void load(cfg);
		// Reload whenever a fetch-affecting config field changes.
	}, [load, cfg.range, cfg.album, cfg.singleEp, cfg.compilations]);

	const update = (patch: Partial<Config>, persist: () => void) => {
		persist();
		setCfg((prev) => ({ ...prev, ...patch }));
	};

	const dismiss = (uri: string) => {
		setDismissed((prev) => {
			const next = prev.includes(uri) ? prev : [...prev, uri];
			writeDismissed(next);
			return next;
		});
	};
	const undo = () => {
		setDismissed((prev) => {
			const next = prev.slice(0, -1);
			writeDismissed(next);
			return next;
		});
	};

	const dismissedSet = React.useMemo(() => new Set(dismissed), [dismissed]);
	const visible = React.useMemo(() => releases.filter((r) => !dismissedSet.has(r.uri)), [releases, dismissedSet]);
	const groups = React.useMemo(() => groupByDay(visible, cfg), [visible, cfg.relative]);

	const rangeOptions = [
		{ value: "30", label: "30 days" },
		{ value: "60", label: "60 days" },
		{ value: "90", label: "90 days" },
		{ value: "120", label: "120 days" },
	] as const;

	return (
		<div className="new-releases-page">
			<div className="new-releases-header">
				<h1>New Releases</h1>
				<div className="new-releases-controls">
					<Select
						options={rangeOptions}
						value={String(cfg.range) as "30" | "60" | "90" | "120"}
						onChange={(v) => update({ range: Number.parseInt(v, 10) }, () => writeConfig("range", v))}
					/>
					<Chip
						active={cfg.album}
						onClick={() => update({ album: !cfg.album }, () => writeConfig("album", String(!cfg.album)))}
					>
						Albums
					</Chip>
					<Chip
						active={cfg.singleEp}
						onClick={() => update({ singleEp: !cfg.singleEp }, () => writeConfig("single-ep", String(!cfg.singleEp)))}
					>
						Singles &amp; EPs
					</Chip>
					<Chip
						active={cfg.compilations}
						onClick={() =>
							update({ compilations: !cfg.compilations }, () => writeConfig("compilations", String(!cfg.compilations)))}
					>
						Compilations
					</Chip>
					<Chip
						active={cfg.relative}
						onClick={() => update({ relative: !cfg.relative }, () => writeConfig("relative", String(!cfg.relative)))}
					>
						Relative dates
					</Chip>
					{dismissed.length > 0 && (
						<Button variant="secondary" onClick={undo}>Undo dismiss</Button>
					)}
					<IconButton ariaLabel="Refresh" disabled={status === "loading"} onClick={() => void load(cfg)}>⟳</IconButton>
				</div>
			</div>

			{status === "loading" && <p className="new-releases-note">Fetching releases from the artists you follow…</p>}
			{status === "empty" && (
				<div className="new-releases-empty">
					<p>No releases in the last {cfg.range} days from the artists you follow.</p>
					<Button variant="secondary" onClick={() => void load(cfg)}>Try again</Button>
				</div>
			)}

			{status === "ready" && groups.length === 0 && (
				<p className="new-releases-note">Everything here has been dismissed. Use “Undo dismiss” to bring items back.</p>
			)}

			{status === "ready" && groups.map((group) => (
				<section className="new-releases-group" key={group.label}>
					<h2 className="new-releases-date">{group.label}</h2>
					<div className="new-releases-grid">
						{group.items.map((r) => <ReleaseCard key={r.uri} release={r} cfg={cfg} onDismiss={dismiss} />)}
					</div>
				</section>
			))}
		</div>
	);
};

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register(
		"navlink",
		<NavLink localizedApp="New Releases" appRoutePath={ROUTE} icon={ICON} activeIcon={ICON} />,
	);
	registrar.registerRoute(ROUTE, <Page />);
}
