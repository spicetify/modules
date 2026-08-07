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
| `.main-contextMenu-menuItemButton`               | `color: #ffffffe6`           | every context-menu item — see the specificity note below     |
| `.main-globalNav-searchInputContainer:hover …`   | `color: #fff`                | search magnifier, on hover **and** `:focus-within`           |

For anchors, `color: inherit` beats picking a color — the surrounding context is
always right:

```css
a:not([data-encore-id]):not(.main-contextMenu-menuItemButton) {
	color: inherit;
}
```

### A blanket selector here outranks everything it lands on

That `:not(.main-contextMenu-menuItemButton)` is not decoration, and the reason
generalizes to every rule you add to `_client-colors.scss`.

Everything in the file is nested under `html.spicetify-themed`, which adds a
class **and** a type to each compiled selector. So the anchor rule ships as
`html.spicetify-themed a:not([data-encore-id])` and scores **0-2-2** — the
`:not()` attribute counts as a class. Meanwhile the colors it is meant to
correct are ordinary class rules at **0-1-0**, both the client's and the
theme's. The bridge rule beats all of them, including the ones that were
already right.

Context menus are where this showed up. Spotify renders navigations as `<a>`
and actions as `<button>`, both with `.main-contextMenu-menuItemButton`. The
anchor rule outranked that class and the theme's override of it, so half of
every menu dropped to the inherited body color and the other half stayed at
full strength — with no rule anywhere that says "make these two different".

The rule of thumb:

- Prefer a targeted selector. A blanket element selector in this file is a
  claim over **every** element of that type, not just the unstyled ones.
- If you need a blanket one, exempt what the client or a theme colors by class
  (`:not(.that-class)`), then color that class explicitly.
- Give the explicit rule the **lowest** specificity that still wins. The
  client's state colors — hover, disabled, checked — are typically 0-2-0, so
  anything at 0-2-2 silently eats them too. `a.main-contextMenu-menuItemButton`
  (0-1-1) beats the client's 0-1-1 anchor fallback on source order and leaves
  the states alone; that pair lives in `index.scss`.
- Outside the themed scope, remember `--spice-*` is undefined. Fall back
  through the client's own token: `var(--spice-text, var(--text-base))`.

Computed style alone will not show you this — it reports the winner, not who
lost. Ask CDP for the whole matched list instead. This is the one probe that
needs the `CSS` domain rather than a `Runtime.evaluate` snippet:

```js
await call("DOM.enable");
await call("CSS.enable");
const { root } = await call("DOM.getDocument", { depth: -1, pierce: true });
const { nodeId } = await call("DOM.querySelector", { nodeId: root.nodeId, selector: SEL });
const { matchedCSSRules } = await call("CSS.getMatchedStylesForNode", { nodeId });
// rules come in cascade order, weakest first — the last one setting `color` won
for (const r of matchedCSSRules) {
	const color = r.rule.style.cssProperties.find((p) => p.name === "color");
	if (color) console.log(r.rule.selectorList.text, color.value);
}
```

A bridge selector printed below a class rule that should have won is the bug.
Add `:not()` and color that class yourself.

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

## When the token is the bug, not the theme

Before "this theme is missing a color", check whether the component picked a
token themes actually declare. Coverage across the 14 themes in this repo:

| Token                                          | Declared by                                          |
| ---------------------------------------------- | ---------------------------------------------------- |
| `main`                                         | 13/14                                                |
| `sidebar`, `player`, `button`, `button-active` | 12/14                                                |
| `text`, `subtext`                              | 11/14                                                |
| `card`                                         | 10/14                                                |
| `tab-active`, `misc`                           | 9/14                                                 |
| `selected-row`, `shadow`                       | 8-9/14                                               |
| `highlight`                                    | **5/14**                                             |
| `main-elevated`, `highlight-elevated`          | **4/14**                                             |
| `card-hover`                                   | **1/14** (not canonical — one theme's own invention) |

Reach for the top of that table. A component styled on `--spice-highlight` is
broken on nine themes out of fourteen before anyone writes a line of theme CSS,
and that is the component's bug to fix.

Two rules follow:

- **Prefer the high-coverage token when two are semantically close.** stdlib's
  chip moved from `highlight` to `card` for exactly this reason — and as a
  bonus `card` sits further from `main`, which is what a chip on the page
  background needs for contrast.
- **Never invent a key.** `card-hover` reads naturally and is declared by
  precisely one theme, so anything styled on it is unthemed everywhere else.
  The canonical list is `utils.BaseColorList` in the Go CLI.

The loader backstops the rest: `fillCanonical` (modularLoader `index.ts`)
derives any canonical key a theme omits from ones it did declare, so an
undeclared token resolves inside the theme's own palette instead of falling
back to the dark literal in `var(--spice-card, #202020)`. That is what makes a
low-coverage token _safe_; it does not make it _right_.

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
4. **give it a name in the css-map**, so every theme gets a stable selector
   instead of each one copying the hash,
5. the hash inline, last, with a comment naming the version it was captured on.

Option 4 is the one worth reaching for when a surface matters to more than one
theme. The per-version overlay lives at `classmaps/<key>/css-map.json` and maps
`hash → semantic name`; apply runs it over the whole tree, so the name lands in
the DOM as well as the stylesheets. Add the entry, re-run
`python3 scripts/build_index.py`, and themes can write the `main-*` selector:

```json
{ "qnaFIKUJ9oUIkN97": "main-layoutResizer-seam" }
```

The overlay is still per Spotify version — the point is that one entry updates
per release instead of one rule per theme.

Note this is the **css-map**, not the classmap. They point in opposite
directions: the classmap resolves `MAP.*` paths to hashes for _module sources_
at stage time, while the css-map renames hashes to semantic names inside _the
client itself_. Themes are plain CSS against the client, so the css-map is
their map.

A hash left inline simply stops matching when it goes stale, which degrades to
the unthemed state rather than breaking something else — but it does mean the
bug comes back silently on the next Spotify release.

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
