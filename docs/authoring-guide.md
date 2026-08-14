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
import { client, createRegistrar, type ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

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
	icon: client.icons.lyrics,
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

`onClick` receives the native React mouse event. Use `event.currentTarget` when
an overlay needs to be positioned from the button's bounds; this avoids keeping
a manually registered legacy button solely to obtain its DOM element.

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

## 5. A right-sidebar panel

`registrar.registerPanel(options)` creates a Spicetify-owned panel without
depending on Spotify's private panel state machine. Only one custom panel is
active at a time; opening another replaces it. While open, the native
right-sidebar content stays mounted but hidden and inert, then returns in its
exact previous state when the custom panel closes.

```tsx
const panel = registrar.registerPanel({
	id: "details",
	label: "Track details",
	width: { default: 360, min: 280, max: 520 },
	render: () => <TrackDetails />,
});

registrar.placeButton("playbar", {
	label: "Track details",
	icon: DETAILS_ICON,
	onClick: () => panel.toggle(),
});
```

The controller exposes `open()`, `close()`, `toggle()`, `isOpen()`,
`subscribe(listener)`, and `dispose()`. Registration IDs are namespaced by the
module automatically. Escape and the panel's close button close it, focus
returns to the opener, and the registrar disposes it on module unload.

Use `subscribe` when a button or another surface needs a reactive active state.
Lifecycle callbacks (`onOpen`, `onClose`) are optional and isolated: an
exception is logged without stranding the right sidebar.

---

## 6. The typed client surface

Import `client` from stdlib instead of reading the ambient wrapper global. It
is the v3 capability boundary for `player`, `platform`, `uri`, `icons`,
`cosmos`, `graphQL`, `keyboard`, `contextMenu`, `popupModal`, `storage`, and
the remaining client services:

```ts
import { client } from "/modules/stdlib/mod.ts";

client.player.next();
client.platform.History.push("/search");
client.notify("Done");
```

The getters resolve lazily, so capabilities attached later in client startup
remain visible. stdlib currently adapts the compatibility wrapper internally;
keeping that access behind one boundary lets it replace or harden a capability
without changing every module. `spicetify-kit check` warns when ordinary module
source reaches for the ambient global directly.

`client.platform.<API>` autocompletes members such as `LibraryAPI`, `History`,
`PlayerAPI`, and `ClipboardAPI`. Method calls stay permissive because Spotify's
generated method signatures have unreliable argument counts. Reach for a
native platform API before an external HTTP call (see the standard for why).

Icons: `client.icons.<name>` returns inner SVG markup ready for
`placeButton`'s `icon`.

---

## 7. Recovery-tier modules: React without the dependency

Most modules should skip this section: a leaf feature imports React from
stdlib at the top of the file, and if stdlib is broken the loader contains the
failure to that module. That is the intended trade.

A recovery surface (a store, a manager, anything you would reach for to fix a
broken client) must not make that trade: its bundle may not touch stdlib or
the network at the top level, or the exact failure it exists to fix takes it
down too. The store's page is the worked example of having both — a React UI
and standalone survival:

- **Type-only imports at the top.** `import type` from stdlib is erased at
  build time; runtime imports of `/modules/stdlib/*` stay inside functions.
- **Acquire React lazily.** A module-level `let React` assigned by an exported
  async loader (dynamic `import("/modules/stdlib/src/expose/React.js")`),
  awaited inside the enhanced path's try block. `ReactDOM` (with `createRoot`)
  is a named export of the same module.
- **Classic JSX pragma.** `/* @jsxRuntime classic */` with
  `/** @jsx React.createElement */` as the file's first lines compiles the
  file's JSX against that lazy binding instead of emitting a jsx-runtime
  import. (Ordinary modules don't need this: the build serves the automatic
  runtime from stdlib, but that is itself a stdlib import.)
- **Keep a React-free fallback.** The vanilla kit
  (`lib/primitives-vanilla.ts`) covers the surface that must survive; the
  React tree is the enhancement, mounted only when stdlib loaded.
- **Prove the bundle.** After building, the dist must contain zero top-level
  `import` statements of stdlib or any network host. `grep -cE "^import "
dist/<name>@<ver>/index.js` should say 0 for a route-registered recovery
  module.

One boot gotcha when rendering a separate React root from a route host's ref:
the ref fires inside the client tree's commit phase, and during boot a second
concurrent root's render can silently never commit. Defer the first render
(two `requestAnimationFrame`s) and verify the node has children afterwards;
release the root and retry on the next visit if not. The store's
`ensureLoaded` implements this.

---

## 8. State, teardown, and shipping

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
  aborts the build). [`publishing.md`](./publishing.md) covers the rest of the
  way: the entry is submitted to this repo's registry, where the artifact is
  downloaded and re-hashed before it can merge.

Then run the [golden-module checklist](./module-standard.md#definition-of-a-golden-module).
