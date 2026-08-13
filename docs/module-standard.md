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
   client imports); `mod.tsx` passes values from stdlib's typed `client`
   capability boundary into it. Starter tests import `logic.ts` and the local `test/setup.mts` harness,
   never `mod.tsx` — JSX and `/modules/*` runtime URLs do not resolve in Node,
   so client-coupled UI is verified live through the dev loop instead.
4. Release by landing a version bump on `main`. The release workflow
   publishes any bumped-but-unpublished module automatically — tag, GitHub
   release with commit history, vault entry — dependency-ordered and
   serialized. Every CI run on `main` lists unreleased work in its job
   summary, so pending state is always one Actions tab away. The manual
   path (`node scripts/release.ts tag --push`) remains as a fallback, and
   third-party authors outside this repo publish with `spicetify-kit
build` → `pack` → `vault add <dist> --artifact <url>`, which writes the
   registry entry, submitted as a pull request here (by hand or from their own
   release workflow via the publish action).
   [`publishing.md`](./publishing.md) walks the submission path.
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

Three **structural warnings** back the modularity rules for js modules —
`tests` (no `*.test.mts` anywhere in the module), `exportable-logic` (nothing
exported beyond the default, so no unit can be imported or tested), and
`pure-core` (no client-free source file at all). They are advisory by design: a
ratchet, not a flag day. The scaffold satisfies all three from the first
commit, so they fire mainly on classic ports that predate the standard — treat
them as the migration worklist, not noise. Modules whose combined source
(excluding `index.ts`) is under 200 lines are exempt from all three: the rules
exist to break up monoliths, and a 30-line theme toggle has no core worth
extracting — live verification covers it.

The dev loop's hot-push is **verified by execution, not by claim**: the push
appends a per-push stamp to the js entry and asserts, inside the client, that
the stamp actually ran before reporting success. A stale instance that still
answers "loaded" now fails the push loudly instead of silently passing. Two
caveats it prints when relevant: css-only themes carry no executable entry to
stamp, and UI that was already mounted before the push may still be the old
build until you re-navigate to its surface — never claim a UI change verified
without remounting it.

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

- **One client boundary.** Import the typed `client` capability surface from
  stdlib instead of reading the ambient `Spicetify` global throughout module
  code. Recovery-tier modules that cannot depend on stdlib at startup keep
  wrapper access inside one local `client.ts` adapter. This gives each runtime
  capability one replaceable, testable boundary rather than many call sites.

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
| `settingsRow`                            | One control in the General group on the standalone Spicetify Settings page                          |
| `settingsSection`                        | A named group on the standalone Spicetify Settings page                                             |
| `settingsAction`                         | A footer action on Spicetify Settings; reserved for global management navigation                    |
| `rootChild`                              | A body-level overlay                                                                                |

For top-bar and playbar buttons, prefer `registrar.placeButton(location, options)`
over the raw button registers above: it adds ordering and native anchoring in one
call. See the [authoring guide](./authoring-guide.md#4-buttons-use-placebutton).
Use the raw registrar entry only when a React component owns changing state or
needs a more specialized lifecycle. First-party modules must not use the legacy
`Spicetify.Playbar.Button` or `Spicetify.Topbar.Button` constructors; stdlib
retains them solely as a migration bridge for third-party v2 extensions.

Themes are a special case: a **css-only module** (a `color.ini` plus `user.css`
as the css entry). The loader parses `[Section]`s into switchable schemes and
applies `--spice-*` variables. `spicetify-kit create --template theme` scaffolds
a fresh css-only theme (starter `color.ini` with two schemes, an `index.css` on
`--spice-*`, no TypeScript tooling); `spicetify-kit from-theme` migrates a
classic theme in one shot.

---

## Versioning and compatibility

Modules declare dependency ranges (`"stdlib": "^1.0.0"`) and the loader
refuses a module whose range the installed dependency cannot satisfy — with
one deliberate asymmetry. A module needing a **newer** dependency than
installed genuinely cannot work, so it refuses with an actionable message.
The reverse is the dependency's call, not the dependent's: a dependency may
declare versions it still answers for in its own metadata:

```json
"version": "1.0.0",
"compat": ["0.3.0"]
```

The loader then loads any dependent whose range admits a vouched version, so
bumping stdlib does not black out every module that has not re-declared its
range yet (community vaults and localStorage installs update on their own
schedules). Omit the entry on a truly breaking release and the strict refusal
returns — the safe default.

Two guards back this up: `scripts/check-deps.ts` (part of `check`) fails a
batch whose workspace ranges are not satisfied by current versions plus
compat, and the store's "Update all" installs dependencies before dependents
so a mid-batch re-enable never races the range check.

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

That fallback is the general lesson for module data: **reach for
`client.platform.*API` before any external HTTP call.** The native APIs
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
