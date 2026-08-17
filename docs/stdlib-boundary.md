# The stdlib compatibility boundary

Spotify compatibility is primarily an infrastructure problem, not a property
we should guess independently for every feature release. Ordinary modules are
therefore insulated by stdlib and version the API they actually consume:

```text
Spotify client -> classmap / stdlib adapters -> stable stdlib API -> feature module
```

When Spotify moves a DOM anchor, webpack export, modal, or player surface, the
normal repair is one stdlib release. Feature modules need a release only when
the stdlib contract they use changes, not merely because Spotify shipped.

This is intentionally not an automatic claim that every module works on every
Spotify build. It makes the real coupling visible and concentrates it where we
can test and repair it.

## The enforced contract

`pnpm check` runs `scripts/stdlib-boundary.ts`. For every first-party module it
requires:

- executable feature modules declare a direct `stdlib` dependency;
- runtime and types come from `/modules/stdlib/mod.js` (`.ts` in source);
- shared React UI comes from `/modules/stdlib/lib/primitives.js`;
- plain-DOM recovery UI comes from `primitives-vanilla.js`;
- no private `stdlib/src/*`, webpack-capture, or register implementation is
  imported;
- no ambient `Spicetify.*`, `MAP.*`, or Spotify-owned DOM selector is used
  without a checked exception.

The public barrel exports the client capability adapter, React identity,
registrars and registered components, storage, logging, modal API, and the
small client-derived types modules are allowed to consume. A path existing in
the stdlib tree does not make it public.

The dependency range is the compatibility record. If a module begins using a
new stdlib API, it raises its minimum stdlib range. If stdlib preserves the API,
the module does not need a Spotify-specific release or compatibility floor.

## External modules

`spicetify-kit check` applies the same source detector to external modules, and
`spicetify-kit build` blocks its error-tier findings. Executable modules must
declare a direct stdlib dependency and may import only the public barrel and
primitive-kit paths. Ambient `Spicetify.*`, direct `MAP.*`, and Spotify-owned
DOM selectors produce warnings because some features genuinely require them.

An intrinsic integration can record a narrow exception in `metadata.json`:

```json
{
	"dependencies": { "stdlib": "^1.10.0" },
	"stdlibBoundary": {
		"exceptions": [
			{
				"file": "mod.tsx",
				"rules": ["client-dom"],
				"reason": "Attaches loop markers to Spotify's playback progress bar."
			}
		]
	}
}
```

The supported exception rules are `ambient-client`, `client-dom`, `direct-map`,
and, for recovery infrastructure, `missing-stdlib-dependency`. Private stdlib
imports are never exemptible. Paths are exact and relative to the module root;
an exception becomes an error when the corresponding coupling disappears.

Running `spicetify-kit check` remains an advisory audit so authors can inspect
all findings at once. The build command fails on structural errors—private
imports, a missing dependency, malformed exception metadata, or stale
exceptions—unless the author explicitly uses `--no-check`.

Themes remain the same explicit client-coupled category described below: they
do not need a stdlib dependency and do not receive DOM/global warnings, but a
JavaScript-enabled theme still cannot import private stdlib implementation
paths.

## Exceptions we actually have

Exceptions live in `stdlib-boundary-exceptions.json`. Every exception names one
file, one or more rules, and a reason. A new violation in another file fails;
an exception whose violation disappeared also fails so the ledger cannot
accumulate dead entries.

### Recovery infrastructure

- **Store** deliberately has no stdlib dependency. It must be able to repair or
  replace stdlib. Ambient wrapper access is isolated to `store/runtime.ts`; the
  enhanced React path imports the public stdlib barrel lazily and falls back to
  owned plain DOM when that fails.
- **Manager** normally depends on stdlib, but its capture-failure panel needs a
  wrapper-level escape hatch. That access is isolated to `manager/runtime.ts`.

These are architectural exceptions, not templates for ordinary modules.

### Themes

Themes are a separate, explicitly client-coupled category. Their purpose is to
restyle and sometimes rearrange Spotify-owned DOM, so pretending they are
stdlib-insulated would hide the risk rather than remove it. Their CSS/DOM/global
access is accepted as a category exception and verified with `theme-report`
against live client routes. Private stdlib imports remain forbidden.

### Feature-specific DOM integrations

| Module               | Why direct client DOM remains                                                  | Boundary opportunity                                                                           |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Adblock              | Removes visual ad containers after slot prevention                             | Keep ad recognition in one adapter; promote a stable ad-state signal if one emerges            |
| Bookmark             | Reads the active page title/artwork to create a bookmark                       | Add an stdlib active-entity snapshot; replace legacy typography/play classes with owned styles |
| Hide window controls | Corrects Spotify's native traffic-light spacer                                 | Promote shell/window-chrome layout control if another module needs it                          |
| Keyboard shortcut    | Spatially navigates Spotify rows, library entries, and viewports               | A generic focus/navigation surface would be justified only by a second consumer                |
| Loopy Loop           | Anchors loop markers to the playback progress bar                              | Add a semantic progress-bar anchor; replace private context-menu classes with owned primitives |
| Lyrics Plus          | Replaces native lyrics, portals into the topbar, and follows the main viewport | Add main-view/topbar anchors; continue removing legacy typography/dropdown classes             |
| Trashbin             | Observes skip-back to distinguish replay from automatic track changes          | Add a semantic skip-back control/event anchor                                                  |

The table distinguishes inherent feature integration from migration debt. We
should not put Spotify typography or context-menu classnames into stdlib merely
to make a checker green; those should become module-owned UI. We should promote
a client anchor or capability when it is semantic, lifecycle-managed, and has
more than one plausible consumer.

## Adding or removing an exception

1. First ask whether an existing stdlib capability or primitive owns the job.
2. If the missing concept is reusable, add a semantic stdlib API and test its
   missing-anchor/degraded behavior.
3. If the feature is intrinsically client-specific, add the narrow file/rule
   exception with a concrete reason and live verification plan.
4. Never exempt a whole feature module. Themes are the only category-wide
   exception because client restyling is their definition.
5. Remove the exception as soon as the direct coupling disappears; CI requires
   this because stale exceptions fail.

This boundary reduces the update surface without promising the impossible: a
Spotify data API can still change behavior, and exception modules/themes still
need live coverage. What changes is that those risks are named instead of being
silently duplicated across every module.
