#!/usr/bin/env node
/**
 * preview - generate a generic SVG card preview for zero-UI modules.
 *
 * Extensions like auto-skip-video or webnowplaying have no UI worth
 * screenshotting, so there is nothing to capture and nothing to reuse.
 * This renders an intentional placeholder instead: dark gradient, an
 * accent glow, a glyph, and the module name. SVG keeps the repo light
 * (no rasterizer dependency) and stays crisp at any card size.
 *
 * usage:
 *   node scripts/preview.ts <module-id> [<module-id>...]
 *
 * Each module gets previews/<id>.svg and its metadata.json preview
 * pointed at the absolute raw URL. Icons/accents come from the map
 * below; unknown modules fall back to a bolt glyph and a hash-picked
 * accent.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO_RAW = "https://raw.githubusercontent.com/spicetify/modules/main/previews";

// 24x24 path markup, drawn in currentColor.
const ICONS: Record<string, string> = {
	// Skip-forward: play triangle + end bar.
	skip: '<path d="M6 5l9 7-9 7z"/><rect x="16.5" y="5" width="2.5" height="14" rx="1.25"/>',
	// Explicit badge: rounded square with an E.
	explicit:
		'<rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2.2"/>' +
		'<path d="M9.8 8h4.7M9.8 12h4M9.8 16h4.7M9.8 8v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
	// Broadcast: radiating arcs over a dot.
	broadcast:
		'<path d="M4.5 9.5a11 11 0 0 1 15 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
		'<path d="M7.2 12.7a7 7 0 0 1 9.6 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
		'<circle cx="12" cy="16.2" r="2"/>',
	// Fallback.
	bolt: '<path d="M13 2 5 13.5h5L10 22l8-11.5h-5z"/>',
};

const MODULE_STYLE: Record<string, { icon: string; accent: string; title?: string }> = {
	"auto-skip-explicit": { icon: "explicit", accent: "#e91429" },
	"auto-skip-video": { icon: "skip", accent: "#f59b23" },
	webnowplaying: { icon: "broadcast", accent: "#3d91f4", title: "Web Now Playing" },
};

const FALLBACK_ACCENTS = ["#1ed760", "#8c9eff", "#d63fb8", "#f59b23", "#3d91f4"];

const xmlEscape = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const prettify = (id: string) =>
	id
		.split("-")
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
		.join(" ");

const CATEGORY_TAGS = ["extension", "theme", "snippet", "app"];

function render(id: string, title: string, category: string, icon: string, accent: string): string {
	const paths = ICONS[icon] ?? ICONS.bolt;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="#1b1b1b"/>
			<stop offset="100%" stop-color="#0e0e0e"/>
		</linearGradient>
		<radialGradient id="glow" cx="50%" cy="40%" r="75%">
			<stop offset="0%" stop-color="${accent}" stop-opacity="0.32"/>
			<stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
		</radialGradient>
	</defs>
	<rect width="1600" height="900" fill="url(#bg)"/>
	<rect width="1600" height="900" fill="url(#glow)"/>
	<g transform="translate(800 430)" text-anchor="middle" font-family="CircularSp, 'Spotify Circular', 'Helvetica Neue', Arial, sans-serif">
		<g transform="translate(-84 -190) scale(7)" fill="#ffffff" color="#ffffff">${paths}</g>
		<text y="90" font-size="76" font-weight="700" fill="#ffffff">${xmlEscape(title)}</text>
		<text y="152" font-size="30" font-weight="600" letter-spacing="7" fill="${accent}">${xmlEscape(category.toUpperCase())}</text>
	</g>
</svg>
`;
}

function main(): void {
	const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
	if (!ids.length) throw new Error("usage: preview.ts <module-id> [<module-id>...]");
	for (const id of ids) {
		const metaPath = path.join("modules", id, "metadata.json");
		const meta = JSON.parse(readFileSync(metaPath, "utf8"));
		const style = MODULE_STYLE[id] ?? {
			icon: "bolt",
			accent: FALLBACK_ACCENTS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % FALLBACK_ACCENTS.length],
		};
		const title = style.title ?? prettify(meta.name ?? id);
		const category = CATEGORY_TAGS.find((t) => (meta.tags ?? []).includes(t)) ?? "module";
		const out = path.join("previews", `${id}.svg`);
		writeFileSync(out, render(id, title, category, style.icon, style.accent));
		meta.preview = `${REPO_RAW}/${id}.svg`;
		writeFileSync(metaPath, `${JSON.stringify(meta, null, "\t")}\n`);
		console.log(`${out} (${title}, ${style.icon}, ${style.accent})`);
	}
}

main();
