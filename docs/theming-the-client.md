# Theming the client: the colors v2 used to rewrite for you

A v2 theme never had to think about the client's own colors. `spicetify apply`
ran a `replaceColors` pass that rewrote the literals baked into Spotify's
stylesheets into `--spice-*` variables before the client ever booted, so a
theme that set `main`, `text` and `subtext` in `color.ini` got a coherent
client for free.

**v3 themes are standalone CSS modules and get no such pass.** The css-map
renames hashed classes back to their `main-*` spellings, and nothing else. Every
place the client hardcodes a color, or derives one at runtime, still renders
exactly as Spotify shipped it: built for a near-black backdrop.

On a dark theme this is mostly invisible. On a **light theme it is the whole
job** — white glyphs on cream, black scrims over pastel, 30%-opacity controls
that were legible as white and are not as brown.

## The three failure classes

### 1. Encore design tokens

The client styles most text and surfaces through Encore custom properties
(`--text-base`, `--text-subdued`, `--background-base`, `--essential-base`,
`--background-elevated-*`, `--background-tinted-*`). They resolve to the
dark-theme palette unless you map them.

Map them once, near the top of the theme, scoped to the theme classes the
client puts on `<html>`:

```css
.encore-dark-theme,
.encore-dark-theme .encore-base-set,
.encore-dark-theme .encore-elevated-set,
.encore-dark-theme .encore-overlay-set {
	--text-base: var(--spice-text);
	--text-subdued: var(--spice-subtext);
	--essential-base: var(--spice-text);
	--essential-subdued: var(--spice-subtext);
	--background-base: var(--spice-main);
	--background-elevated-base: var(--spice-card-background);
	/* …and the rest you care about */
}
```

This one block fixes the large majority of "everything is white" reports. It is
also why `--essential-base` matters: pane resizer hairlines and several icon
strokes read from it.

### 2. Hardcoded literals

Rules that name a color directly. These ignore the token bridge entirely and
have to be overridden by selector. Known hotspots, all confirmed on 1.2.94:

| Selector                                         | Client value                 | What breaks                                                  |
| ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------ |
| `a:not([data-encore-id])`                        | `color: #fff`                | shelf headings ("Jump back in")                              |
| `.main-trackList-rowMainContentTitle`            | `color: #fff`                | every track title                                            |
| `.main-trackList-rowSectionEnd`                  | `color: #fff`                | tracklist end column                                         |
| `.main-genericButton-button`                     | `color: #ffffffb3`           | playbar icon buttons — **every module button rides on this** |
| `.x-filterBox-expandButton`                      | `color: #ffffffb3`           | library filter magnifier + input                             |
| `.Root__globalNav .main-globalNav-navLinkActive` | `color: #fff`                | active Home/nav link                                         |
| `.main-home-filterChipsSectionActive::after`     | `background: rgba(0,0,0,.6)` | scrim over the sticky home chips                             |
| `html`                                           | `background: #121212`        | shows through every panel gap and on load                    |

For anchors, `color: inherit` beats picking a color — the surrounding context is
always right:

```css
a:not([data-encore-id]) {
	color: inherit;
}
```

### 3. Runtime-derived values

`--background-base` is re-derived **per view** from the current artwork, so the
sticky home chips bar arrives tinted with whatever accent the page extracted
(Spotify red on one page, teal on the next). No token mapping survives it;
those surfaces need pinning:

```css
.main-home-filterChipsSection {
	background-color: var(--spice-main) !important;
}
```

Opacity is the same story in reverse: inactive shuffle/repeat sit at
`opacity: .3`, which reads fine as white on near-black and disappears as a mid
tone on a pastel. Raise it rather than recoloring.

## Finding them: the CDP recipe

Drive the running client over CDP (see the workspace `AGENTS.md` for the
helper scripts). Sweeping computed styles is far faster than reading Spotify's
minified CSS.

**Sweep for white text:**

```js
[...document.querySelectorAll("*")]
	.filter((e) => e.children.length === 0 && e.textContent?.trim())
	.filter((e) => getComputedStyle(e).color === "rgb(255, 255, 255)")
	.map((e) => e.textContent.trim().slice(0, 24));
```

**Sweep for white icons** — a text sweep misses these, because an `svg` has no
text node. Check `color` _and_ `fill` on `svg`/`button`/`path`.

**Sweep for dark scrims**, including pseudo-elements:

```js
for (const e of document.querySelectorAll("*")) {
	for (const p of [null, "::before", "::after"]) {
		const s = getComputedStyle(e, p);
		if (p && s.content === "none") continue;
		// flag low-luminance backgroundColor with alpha > .15
	}
}
```

### Three traps that cost real time

- **`elementFromPoint` cannot see scrims.** Overlays are routinely
  `pointer-events: none`, so the hit-test walks straight past them and hands
  you the element _underneath_, which looks correctly themed. Scan the tree
  geometrically instead.
- **Pseudo-elements are invisible to element scans.** The 60%-black slab over
  the home chips lives entirely in an `::after`. Always pass the pseudo
  argument to `getComputedStyle`.
- **When computed style says one thing and the screen says another, force the
  element a garish color.** Setting the chips bar `#00ff00` rendered _dark_
  green, which proved a translucent black layer sat on top and pointed
  straight at the `::after`. This is the fastest way to separate "my rule
  didn't apply" from "something is painting over it".

## What you cannot theme

Not every mismatch is yours to fix; check before chasing one.

- **Alpha masks.** The carousel's overflow fade is a `mask-image`, not a color.
  It already fades to whatever is behind it — your background. Grey there is
  dark album art at partial alpha, and there is no color to point at the theme.
- **Over-media scrims.** Elements carrying `encore-over-media-set` are meant to
  sit on artwork; their dark backdrop is correct even on a light theme.

The way to tell: disable the theme and re-read the same computed property. If
it is byte-identical, the client owns it.

## Build-hashed classes

Some surfaces only have hashed class names (`.qnaFIKUJ9oUIkN97`), which change
between Spotify builds. Prefer, in order:

1. a stable `main-*` / `x-*` name (the css-map guarantees these),
2. a semantic attribute — `[data-encore-id="buttonTertiary"]`,
   `[data-testid="control-button-repeat"]`,
3. a stable ancestor plus structure — `.Root__right-sidebar [data-encore-id=…]`,
4. the hash, last, with a comment naming the version it was captured on.

A hash that goes stale simply stops matching, which degrades to the unthemed
state rather than breaking something else — but it does mean the bug comes
back silently on the next Spotify release, so leave the version in the comment.

## Checklist for a light theme

- [ ] Encore token bridge in place
- [ ] `html` background set (kills the load flash and the gap bleed)
- [ ] anchors inherit
- [ ] tracklist titles and end column
- [ ] `.main-genericButton-button` (all module playbar buttons)
- [ ] library filter box
- [ ] sticky home chips bar **and** its `::after`
- [ ] inactive shuffle/repeat opacity
- [ ] sweep for white text, then again for white icons, then for dark scrims
      including pseudo-elements
