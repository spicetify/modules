# Module best practices

stdlib will let you mount almost anything almost anywhere. This document is
about what you _should_ do, so that ten installed modules still feel like one
coherent Spotify rather than ten tenants fighting over the chrome.

The rule behind most of what follows: **a surface belongs to the user, not to
your module.** Every module author thinks their feature deserves a permanent
spot in the top bar. If they all act on it, the top bar is unusable.

---

## Put settings in Spicetify Settings

If your module has options, they belong on the standalone Spicetify Settings
page, via the `settingsSection` register:

```tsx
import { SettingsRow, SettingsSection } from "/modules/stdlib/lib/primitives.js";
import { registers } from "/modules/stdlib/mod.js";

registrar.register(
	"settingsSection",
	<SettingsSection title="Shuffle+">
		<SettingsRow label="Shuffle whole library">
			<Toggle value={enabled} onChange={setEnabled} />
		</SettingsRow>
	</SettingsSection>,
);
```

`SettingsSection` and `SettingsRow` render the client's settings structure, so
your options line up consistently and inherit Spotify and theme styling. Small
one-boolean modules should use `settingsRow`; stdlib groups those rows under
General. All contributed controls stay visible rather than hiding behind an
additional modal or disclosure.

**Do not put settings in the account dropdown.** You _can_: `Menu.Item` works,
and it is the shortest path to a visible toggle. It is also where the user
looks for account actions, not for your module's preferences, and it is a
single shared list that every module can append to. Three modules doing this
turns the profile menu into a settings page nobody designed. The same applies
to the context menu: `ContextMenu.Item` is for acting on the right-clicked
item, not for configuration.

A useful test: if the control changes something _about your module_, it is a
setting. If it acts on _the thing the user is looking at right now_, it is a
menu item.

---

## Earn your place in the chrome

Ranked from cheapest to most intrusive for the user:

| Surface                     | Use it for                                            |
| --------------------------- | ----------------------------------------------------- |
| `settingsRow`               | one small setting in the shared General group         |
| `settingsSection`           | a named group of module settings                      |
| `settingsAction`            | reserved global navigation at the bottom of settings  |
| `route` + `navlink`         | a whole feature with its own page                     |
| `menu` / `ContextMenu.Item` | an action on the current or right-clicked item        |
| `playbarButton`             | a control the user reaches for _while playing_        |
| `topbarRightButton`         | a genuinely global action, and even then, think twice |

One persistent button per module is a reasonable ceiling. If you need more,
you need a route, not more buttons.

Prefer `registrar.placeButton(location, opts)` over hand-building a button and
picking a register key. It gives you ordering (`order`) and native anchoring
(`near: { anchor: "playbar:lyrics" }`) so your control sits where the user
would expect rather than wherever insertion order happened to put it.

Every first-party button must still be owned by a registrar. A stateful button
may use `registrar.register("playbarButton", <MyButton />)` instead of
`placeButton`, but it must not instantiate the legacy `Spicetify.Playbar.Button`
or `Spicetify.Topbar.Button` APIs and manually manage registration. Those
compatibility surfaces exist for v2 extensions; the registrar is what
guarantees v3 unload cleanup.

---

## Degrade, never destroy

The client changes under you. A module that cannot find its anchor must
disappear quietly, not take the client with it.

- **Bound every wait.** An unbounded `await` in your default export hangs the
  entire loader: `Spicetify.Modules` never gets set and _every_ module silently
  fails to load, with no error. Cap the retries and give up.
- **Never assume a selector resolves.** Check, and no-op if it does not.
- **Clean up in `ctx.defer(...)`.** Anything you mount, listen to, or patch has
  to come back off when your module unloads.
- **Do not patch what you do not own.** Wrapping a client API to observe it is
  a debugging technique, not a shipping one.

---

## Respect the shared namespace

- **Prefix your storage keys** with your module id. `createStorage` already
  scopes for you; use it rather than raw `localStorage`.
- **One theme at a time.** The loader enforces a single active theme; do not
  fight it by injecting global CSS from a non-theme module.
- **Scope your CSS.** Style inside your own container. A bare `button { }` rule
  in a module stylesheet restyles the whole client.

---

## Fetching

- Fetch CORS-friendly hosts directly.
- For hosts that block you, use `client.corsProxy.fetch`, which tries the
  local daemon first and falls back to the hosted proxy. Do not hardcode either
  endpoint.
- `CosmosAsync` reaches Spotify's own authed endpoints; do not use it as a
  general-purpose HTTP client.

---

## Assets

A module's `assets/` are only served when the module is **staged** into the app
bundle. A store or dev install keeps files in localStorage and serves JS as
blobs, so an absolute `/modules/<id>/assets/...` URL silently 404s for most
users. Inline small assets as `data:` URLs, or host them remotely.

---

## Before you publish

- `spicetify-kit build` passes without `--no-check`.
- Your module loads on a **clean staged boot**, not just after a dev hot-push.
  Check `Spicetify.Modules.report()` and confirm your id is in `loaded`, not
  `failed`.
- Unloading it leaves no DOM, listeners, or timers behind.
- Declare a dependency range on stdlib that you have actually tested against.
