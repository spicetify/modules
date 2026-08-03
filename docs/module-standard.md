# The Spicetify Module Standard

Two goals, one path: a module should be **reliable** (it degrades instead of
breaking, and never takes the client down with it) and **easy to build**
(typed, scaffolded, hot-reloaded). These are the same investment — the tooling
that makes a module easy to write is the tooling that makes it hard to break.
The rule this standard is built on: **make the reliable path the easy path.**
The scaffold generates code that already follows everything below; the sections
after the happy path explain what it bakes in and why. For a hands-on
walkthrough (scaffold, registrars, `placeButton`, the typed surface), see the
[authoring guide](./authoring-guide.md).

---

## The happy path

1. `npm create spicetify-module my-module` — a typed project: the loader entry
   shim, a hello-world `mod.tsx`, SCSS, and a `tsconfig` wired to stdlib's
   vendored types.
2. `npm run dev` — watch, rebuild, and hot-push into a running client over CDP
   in about a second. No restage, no restart. Pass `-- --launch` to have the
   kit start (or reuse) Spotify with the remote-debugging port itself; without
   it, start Spotify with `--remote-debugging-port=9229` yourself.
   `Spicetify.Modules.removeLocal` drops the override.
3. `npm run check` and `npm run test` — typecheck plus happy-dom unit tests.
   Testable behavior lives in a dependency-free `logic.ts` (no `/modules/*` or
   client imports); `mod.tsx` injects the client objects (`Spicetify.*`) into
   it. Starter tests import `logic.ts` and the local `test/setup.mts` harness,
   never `mod.tsx` — JSX and `/modules/*` runtime URLs do not resolve in Node,
   so client-coupled UI is verified live through the dev loop instead.
4. `spicetify-kit build` → `pack` → publish the zip to a vault. `spicetify-kit
vault add <dist> --artifact <url>` records it with an embedded metadata
   subset and a sha256 checksum; `spicetify-kit install <zip|dir>` sideloads a
   packed module straight into a running client.
5. Ship a preview. Store cards are artwork-first, so `metadata.json` must
   carry an absolute https `preview` or `vault add` refuses the entry. Capture
   a real screenshot whenever the module has UI (16:9, vendored under
   `previews/` in this repo); for zero-UI modules (utilities with nothing to
   screenshot) `node scripts/preview.ts <id>` generates a designed SVG
   placeholder (glyph + accent + name) and wires the metadata up.

If you are doing something the happy path does not cover, that is a signal to
check the rules below before hand-rolling around them.

`spicetify-kit build` enforces the standard's **error tier**: error-tier
findings (bad metadata, a missing loader shim) abort the build before any dist
output; heuristic nudges stay advisory (they print, the build continues), and
`--no-check` bypasses the check entirely. css-only theme modules declare no js
entry, so the loader-shim rule does not apply to them. The dev loop prints
findings but never blocks the hot-push.

---

## The reliability contract (non-negotiable)

Break one of these and your module can break the client. The loader and stdlib
give you all of them for free when you follow the standard — do not opt out.

- **Degrade, never destroy.** A missing classmap leaf or a drifted webpack
  needle must cost one feature, never your module or the client. Go through
  stdlib's typed, safe-by-default surfaces (needle misses return `undefined`
  and log a targeted warning; hostile client exports are already handled).
  Never top-level-destructure a needle result — one dead needle then takes the
  whole file down.

- **Ship MAP-intact.** Reference client classes as `MAP.a.b.c`. The CLI remaps
  them at apply/install time against the _exact_ installed classmap, so one
  build serves every Spotify version. A hardcoded hashed classname silently
  matches nothing on the next client update.

- **One React.** Import React only from stdlib (`expose/React`) or the shimmed
  bare `react` specifier — never bundle a second copy. Hooks and context must
  resolve to the client's own instance or renders die (#321).

- **Self-subscribe to external state.** Registered elements are frozen; the
  anchor will not re-render them. Anything that reflects route/player/settings
  state subscribes to that state itself and forces its own re-render
  (`useHistoryRefresh` is the canonical pattern for route-active UI).

- **Dispose what you touch.** Every register, adopted stylesheet, event
  listener, and timer is undone on unload. `createRegistrar(ctx)` auto-disposes
  what you register; you clear the timers, overlays, and subscriptions you own.
  A module that leaks or lingers after a reload is a bug.

- **Contain your crashes.** Registered items render behind per-item error
  boundaries and the loader swallows unhandled rejections whose stack points at
  module code — but treat that as a safety net, not a license. A module must
  never be able to take down the client.

---

## The component-tier decision

Build UI from the kit's named primitives — `Button`, `IconButton`, `Select`,
`TextInput`, `Textarea`, `Badge`, `Chip`, `Card`, `ConfirmButton`, `Dialog`,
`MenuItem`, and the `h()` hyperscript — never hand-rolled
`el("select", "spicetify-select")`. Each primitive owns the client class it
needs, so module code gets a native Spotify look without ever naming a client
class itself (that is what keeps you MAP-intact by construction). There are two
tiers over **one shared class contract** (`lib/primitives-classes.ts`), so the look is
identical; the choice is purely about reliability.

| Your surface is…                                                                                                                                                        | Use                                                                                            | Because                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A **recovery / infrastructure** tool that must keep working when _other_ modules break — a store, a module manager, anything you would reach for to fix a broken client | **Vanilla kit** — `lib/primitives-vanilla.ts`                                                  | React-free DOM survives a failed React capture or needle drift after a Spotify update, which is the exact moment you need it |
| A **leaf feature** — a settings pane, a nice-to-have panel, a route page that is not itself a recovery tool                                                             | **React primitives** — `lib/primitives.js` (or real Encore components from `ComponentLibrary`) | Richer and more native; here "goes dark after an update until a needle refresh" is an annoyance, not a trap                  |

The test: **if the client half-breaks after a Spotify update, does this surface
still need to work?** Yes → vanilla. No → React. When unsure, vanilla costs you
nothing but a little polish, and polish only shows when everything is healthy —
which is when the vanilla version already looks fine.

A recovery surface must also do its real work through the loader
(`Spicetify.Modules.installLocal/enable/disable/removeLocal`), which is
loader-level and independent of stdlib, and keep a React-free fallback so it can
rescue a client where the enhanced path failed.

---

## Reach for the register that fits

Mount into the client transform-free through `createRegistrar(ctx)`; it disposes
for you on unload.

| Register                                 | Surface                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `navlink`                                | Global-nav circular icon (the Home pattern), with active/inactive glyph states                      |
| `route`                                  | A full page at `/bespoke/<name>` — `registrar.registerRoute(path, element)`                         |
| `menu`                                   | Context-menu items — the kit's `MenuItem` plus `openedFromProfileMenu(ctx)` / `closeMenu()` helpers |
| `topbarLeftButton` / `topbarRightButton` | Top-bar icon buttons                                                                                |
| `playbarButton` / `playbarWidget`        | The now-playing bar                                                                                 |
| `settingsSection`                        | A section on Spotify's own settings page                                                            |
| `rootChild`                              | A body-level overlay                                                                                |

For top-bar and playbar buttons, prefer `registrar.placeButton(location, options)`
over the raw button registers above: it adds ordering and native anchoring in one
call. See the [authoring guide](./authoring-guide.md#4-buttons-use-placebutton).

Themes are a special case: a **css-only module** (a `color.ini` plus `user.css`
as the css entry). The loader parses `[Section]`s into switchable schemes and
applies `--spice-*` variables. `spicetify-kit create --template theme` scaffolds
a fresh css-only theme (starter `color.ini` with two schemes, an `index.css` on
`--spice-*`, no TypeScript tooling); `spicetify-kit from-theme` migrates a
classic theme in one shot.

---

## Test like the project tests

- **Pure logic and DOM** → `node --test` with happy-dom (the harness ships with
  the scaffold). Assert structure, classes, and behavior — not pixel layout.
- **Client-React UI** → live-verify through the dev loop (CDP against the
  running client). The client is the only real environment for anything using
  the client's React or components: happy-dom proves structure, the client
  proves rendering.

---

## Two worked examples

The repo ships two ported modules that exercise the whole standard end to end:

- **`auto-skip-explicit`** (an _extension_): behavior plus one UI leaf. It skips
  explicit tracks by self-subscribing to the player and undoing that listener on
  unload, and adds a profile-menu toggle through the `menu` register and the
  kit's `MenuItem`. It declares no page and ships js-only.
- **`new-releases`** (an _app_): a `navlink` + `route` page built from the React
  kit (`Card`, `Button`, `IconButton`). It shows _degrade, never destroy_ in the
  large: its faithful primary source (Spotify's `browse/new-releases` Web API)
  is unreliable from a v3 module — `CosmosAsync` does not proxy `api.spotify.com`
  dependably — so an empty or failed result falls back to the native
  `Platform.LibraryAPI`, and the page always renders real, playable content
  instead of an error.

That fallback is the general lesson for module data: **reach for the client's
own `Spicetify.Platform.*API` before any external HTTP call.** The native APIs
are authenticated, same-origin, and stable; external endpoints (`api.spotify.com`
via `CosmosAsync`, or a cors-proxied third party like the classic reddit app's
feed) are rate-limited or CORS-blocked from module code and must never be the
only source a feature depends on.

---

## Definition of a golden module

- [ ] Scaffolded, typechecks, has unit tests, hot-reloads.
- [ ] References client classes as `MAP.*` — zero hardcoded hashed classnames.
- [ ] Goes through stdlib's typed surfaces, never raw needle destructures.
- [ ] Builds its UI from the kit, and picked the tier with the recovery-vs-leaf test.
- [ ] Self-subscribes to external state; disposes everything on unload.
- [ ] Cannot take down the client — verified by disabling and removing it live.
- [ ] `metadata.json` declares dependencies, version, entries, and an absolute
  https `preview`; ships MAP-intact.
