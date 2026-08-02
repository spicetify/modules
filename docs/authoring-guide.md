# Building a module: a walkthrough

Companion to [the module standard](./module-standard.md). The standard is the
contract (what a reliable module must do); this is the hands-on path (how to
build one). Every command and API below is what the scaffold and stdlib
actually give you.

---

## 1. Scaffold and run

```sh
npm create spicetify-module my-module    # or: spicetify-kit create my-module
cd my-module
npm run dev -- --launch                  # watch + hot-push over CDP (~1s)
```

`dev` rebuilds and pushes on every save with no restage and no restart.
`--launch` starts (or reuses) Spotify with the remote-debugging port for you;
without it, start Spotify yourself with `--remote-debugging-port=9229`. Drop the
hot-pushed override with `Spicetify.Modules.removeLocal("my-module")`.

What the scaffold generates:

- `metadata.json` — id, version, entries, and dependencies (declares `stdlib`).
- `index.ts` — the loader entry shim. Leave it.
- `mod.tsx` — your module.
- `logic.ts` — dependency-free logic, unit-testable in Node.
- `index.scss` — styles, adopted as a stylesheet and auto-disposed on unload.

---

## 2. The module entry

A module default-exports one function and the loader awaits it. Everything you
mount goes through a registrar, which disposes all of it when the module
unloads.

```ts
import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

export default async function (ctx: ModuleRuntimeContext) {
  const registrar = createRegistrar(ctx);
  // register UI here
  ctx.defer(() => {
    // clear the timers, overlays, and listeners you own
  });
}
```

Bound the loader. The loader `await`s this function, so an unbounded `await`
(for example polling for a DOM node that never appears) hangs the loader and
every module then fails to load, silently. Cap every wait and degrade.

---

## 3. A page (navlink + route)

```ts
import { NavLink } from "/modules/stdlib/src/registers/navlink.tsx";

const ROUTE = "/bespoke/my-module";

registrar.register(
  "navlink",
  <NavLink localizedApp="My Module" appRoutePath={ROUTE} icon={ICON} activeIcon={ICON} />,
);
registrar.registerRoute(ROUTE, <Page />);
```

`icon` and `activeIcon` are inner SVG markup drawn on the 16-grid.

---

## 4. Buttons: use `placeButton`

`registrar.placeButton(location, options)` is the one ergonomic way to add a
button. It replaces picking a register key and hand-building the matching
component, and it gives you ordering and native anchoring for free.

```ts
registrar.placeButton("topbar-right", {
  label: "Popup Lyrics",
  icon: Spicetify.SVGIcons.lyrics,
  onClick: () => togglePip(),
});
```

Options:

- `location`: `"topbar-left" | "topbar-right" | "playbar"`.
- `label` (required): tooltip and accessible name.
- `icon`: inner SVG markup on the 16-grid.
- `onClick` (required).
- `order`: position among module buttons in that slot, lower renders earlier
  (default 0). Plain `register()` buttons stay at order 0 (insertion order).
- `isActive`: playbar only, draws the active indicator.
- `disabled`: greyed and inert.

It returns a handle with `remove()`; the button is also removed automatically
when the module unloads.

**Native anchoring.** `near` sits the button next to one of the client's own
buttons instead of in the module-button group:

```ts
registrar.placeButton("playbar", {
  label: "Loop section",
  icon: LOOP_ICON,
  onClick: toggleLoop,
  near: { anchor: "playbar:queue", side: "before" },
});
```

Anchors are stable, stdlib-owned names, locale-independent (backed by
`data-testid`, not the localized aria-label): `playbar:lyrics`, `playbar:queue`,
`playbar:mute`, `playbar:miniplayer`, `playbar:fullscreen`. `side` defaults to
`"after"`. If an anchor cannot be resolved on the running client, the button
falls back to ordinary `order` placement, so it is never hidden.

**When not to use it.** `placeButton` is for static buttons and exposes no DOM
element. If a button manages its own active state from player or route events,
or you need its element (say, to anchor a popup off it), keep it as a
self-managing `register("playbarButton", <Component/>)` component instead. The
bookmark module works around the missing element handle by looking its mounted
button up by aria-label under `.spicetify-topbar-right-buttons`.

---

## 5. The typed surface

`Spicetify` is typed by default. There is no `const Spicetify = (globalThis as
any)` cast; use the bare global and you get autocomplete on the client helpers a
module actually reaches for: `Player`, `Platform`, `URI`, `SVGIcons`,
`CosmosAsync`, `GraphQL`, `React`, `Menu` / `ContextMenu`, `PopupModal`,
`Mousetrap`, `LocalStorage`, and the rest.

`Spicetify.Platform.<API>` autocompletes member names (`LibraryAPI`, `History`,
`PlayerAPI`, `ClipboardAPI`, and so on). Method calls stay permissive on
purpose: the client's generated method signatures have unreliable argument
counts, so the types surface which members exist without turning correct calls
into false errors. Reach for a native `Platform.*API` before any external HTTP
call (see the standard for why).

Icons: `Spicetify.SVGIcons.<name>` returns inner SVG markup, ready to drop into
`placeButton`'s `icon`.

---

## 6. State, teardown, and shipping

These are the contract; [the standard](./module-standard.md) carries the detail.

- **Self-subscribe to external state.** Registered elements are frozen, so
  anything reflecting player, route, or settings state subscribes to that state
  itself and forces its own re-render (`useHistoryRefresh` is the pattern for
  route-active UI).
- **Dispose everything.** The registrar undoes registers and adopted styles; you
  clear the timers, overlays, and subscriptions you own through `ctx.defer`. A
  module that lingers after a reload is a bug.
- **Build UI from the kit primitives**, not raw client classes, and pick the
  tier with the recovery-vs-leaf test.
- **Ship** with `spicetify-kit build` then `pack` then `vault add`. `build`
  enforces the standard's error tier (bad metadata or a missing loader shim
  aborts the build).

Then run the [golden-module checklist](./module-standard.md#definition-of-a-golden-module).
