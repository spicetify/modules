/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "new-releases" custom
 * app by khanhas. The classic app pulled releases from an external Spotify
 * Web API call; that path is unreliable from a v3 module (CosmosAsync does
 * not proxy api.spotify.com dependably), so this port keeps the faithful
 * endpoint as the primary source and degrades to the client's native
 * library layer — the degrade-not-destroy rule in practice.
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { NavLink } from "/modules/stdlib/src/registers/navlink.tsx";
import { Button, Card, IconButton } from "/modules/stdlib/lib/ui-react.js";

const Spicetify = (globalThis as { Spicetify?: any }).Spicetify;
const ROUTE = "/bespoke/new-releases";
const ICON = '<path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="currentColor"/>';

interface Release {
	uri: string;
	name: string;
	artist: string;
	imageUrl: string;
}

// spotify:image:HASH is not a browser-loadable URL; map it to the CDN. An
// http(s) URL (what the Web API returns) is already displayable.
const artUrl = (raw?: string): string =>
	raw?.startsWith("spotify:image:") ? `https://i.scdn.co/image/${raw.slice("spotify:image:".length)}` : raw ?? "";

// Faithful primary: Spotify's own new-releases endpoint. Every miss returns
// [] so the caller can degrade instead of throwing.
async function fetchNewReleases(): Promise<Release[]> {
	try {
		const market = (await Spicetify?.Platform?.ProductStateAPI?.getValues?.())?.country ?? "US";
		const res = await Spicetify?.CosmosAsync?.get(
			`https://api.spotify.com/v1/browse/new-releases?country=${market}&limit=50`,
		);
		const items = res?.albums?.items ?? [];
		return items.map((a: any) => ({
			uri: a.uri,
			name: a.name,
			artist: a.artists?.[0]?.name ?? "",
			imageUrl: artUrl(a.images?.[0]?.url),
		}));
	} catch {
		return [];
	}
}

// Reliable native fallback: the tracks most recently added to the library.
async function fetchRecentlyAdded(): Promise<Release[]> {
	try {
		const res = await Spicetify?.Platform?.LibraryAPI?.getTracks?.({
			limit: 50,
			sort: { field: "ADDED_AT", order: "DESC" },
		});
		const items = res?.items ?? [];
		return items.map((t: any) => ({
			uri: t.uri,
			name: t.name,
			artist: t.artists?.[0]?.name ?? "",
			imageUrl: artUrl(t.album?.images?.[0]?.url ?? t.images?.[0]?.url),
		}));
	} catch {
		return [];
	}
}

type Status = "loading" | "ready" | "empty";

const Page = () => {
	const [status, setStatus] = React.useState<Status>("loading");
	const [items, setItems] = React.useState<Release[]>([]);
	const [fellBack, setFellBack] = React.useState(false);

	// The route element lives in a frozen registry, so guard against a
	// setState landing after the page unmounts mid-fetch.
	const mounted = React.useRef(true);
	React.useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const load = React.useCallback(async () => {
		setStatus("loading");
		let list = await fetchNewReleases();
		let fallback = false;
		if (!list.length) {
			list = await fetchRecentlyAdded();
			fallback = true;
		}
		if (!mounted.current) return;
		setItems(list);
		setFellBack(fallback);
		setStatus(list.length ? "ready" : "empty");
	}, []);

	React.useEffect(() => {
		void load();
	}, [load]);

	return (
		<div className="new-releases-page">
			<div className="new-releases-header">
				<h1>New Releases</h1>
				<IconButton ariaLabel="Refresh" onClick={() => void load()}>⟳</IconButton>
			</div>

			{fellBack && status === "ready" && (
				<p className="new-releases-note">
					New releases are unavailable right now — showing what you recently added.
				</p>
			)}
			{status === "loading" && <p className="new-releases-note">Loading…</p>}
			{status === "empty" && (
				<div className="new-releases-empty">
					<p>Nothing to show yet.</p>
					<Button variant="secondary" onClick={() => void load()}>Try again</Button>
				</div>
			)}

			{status === "ready" && (
				<div className="new-releases-grid">
					{items.map((r) => (
						<Card key={r.uri}>
							<div className="new-releases-card">
								{r.imageUrl
									? <img className="new-releases-cover" src={r.imageUrl} alt="" loading="lazy" />
									: <div className="new-releases-cover new-releases-cover--empty" />}
								<div className="new-releases-meta">
									<span className="new-releases-name" title={r.name}>{r.name}</span>
									<span className="new-releases-artist" title={r.artist}>{r.artist}</span>
								</div>
								<Button onClick={() => Spicetify?.Player?.playUri?.(r.uri)}>Play</Button>
							</div>
						</Card>
					))}
				</div>
			)}
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
