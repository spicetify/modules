/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { client, React } from "/modules/stdlib/mod.ts";
import { Badge } from "/modules/stdlib/lib/primitives.js";
import type { RedditItem } from "./logic.ts";

const PlayIcon = () => (
	<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
		<path d="M8 5v14l11-7z" fill="currentColor" />
	</svg>
);

const Placeholder = ({ kind }: { kind: RedditItem["kind"] }) => (
	<div className="reddit-v3-cover reddit-v3-cover--empty" aria-hidden="true">
		<svg viewBox="0 0 24 24" width="44" height="44">
			{kind === "playlist" ? (
				<path d="M4 5h16v2H4zm0 6h11v2H4zm0 6h8v2H4zm13-6 5 3.5-5 3.5z" fill="currentColor" />
			) : (
				<path
					d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 7.25a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Z"
					fill="currentColor"
				/>
			)}
		</svg>
	</div>
);

const clientPath = (uri: string): string | null => {
	try {
		return client.uri.fromString(uri).toURLPath(true) || null;
	} catch {
		return null;
	}
};

export const RedditCard = ({ item }: { item: RedditItem }) => {
	const path = clientPath(item.uri);
	return (
		<article className="reddit-v3-card">
			<div className="reddit-v3-cover-wrap">
				{item.imageUrl ? (
					<img className="reddit-v3-cover" src={item.imageUrl} alt="" loading="lazy" />
				) : (
					<Placeholder kind={item.kind} />
				)}
				<button
					type="button"
					className="reddit-v3-play"
					aria-label={`Play ${item.title}`}
					onClick={() => client.player.playUri(item.uri)}
				>
					<PlayIcon />
				</button>
			</div>
			<div className="reddit-v3-card-copy">
				<strong title={item.title}>
					{/* A real anchor, stretched over the card by its ::after, so
					    the title is the card's accessible name and Enter/Space
					    keep their native meanings on both the link and Play. */}
					{path ? (
						<a
							className="reddit-v3-card-link"
							href={path}
							onClick={(event) => {
								event.preventDefault();
								client.platform.History.push(path);
							}}
						>
							{item.title}
						</a>
					) : (
						item.title
					)}
				</strong>
				<span title={item.subtitle}>{item.subtitle}</span>
				<div className="reddit-v3-card-detail">
					<Badge>
						{item.kind === "track" ? "Song" : `${item.kind[0].toUpperCase()}${item.kind.slice(1)}`}
					</Badge>
					{typeof item.followers === "number" ? <span>{item.followers.toLocaleString()} likes</span> : null}
				</div>
			</div>
		</article>
	);
};
