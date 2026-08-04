# lyrics-plus pre-refactor baseline (U6)

Captured 2026-08-04 against the unmodified module, before any extraction, so
U5 can compare rather than assert. Client 1.2.94 (`129400583`).

## Client state to restore after U5

`Spicetify.Modules.listLocal()` held these 11 local installs, `lyrics-plus`
among them, with `Spicetify.Modules.report.failed` empty:

`auto-skip-explicit`, `auto-skip-video`, `bookmark`, `burnt-sienna`,
`full-app-display`, `lyrics-plus`, `nightlight`, `palette-manager`,
`popup-lyrics`, `sleek`, `store`

## Registry entries

Six entries, per `mod.tsx:1653-1913`.

| Entry        | Baseline result                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `spotify`    | Not exercised — the test track resolved through `lrclib` first. U5 must select it explicitly.                                      |
| `lrclib`     | **Verified.** Panel mounted, lyrics rendered, footer read `Lyrics provided by lrclib`. Real payload saved as `lrclib-synced.json`. |
| `musixmatch` | Not exercised (requires a valid usertoken in this session).                                                                        |
| `netease`    | Not exercised.                                                                                                                     |
| `genius`     | Not exercised.                                                                                                                     |
| `local`      | Not exercised (no local lyrics stored).                                                                                            |

## Rendered baseline

Route `/lyrics-plus` mounted its container and rendered synced lines for the
playing track, sourced from `lrclib`.

## U5 minimum bar

Per the plan, U5 needs `spotify` plus at least two other providers verified,
and `local` verified. Entries unexercised **here** are not excused there — this
table records what was reachable in one session, not a licence to skip them.
Anything unreachable in both U6 and U5 is excluded from the count and named.

## U5 result (2026-08-05, post U3/U4 extraction)

Sweep by forcing each provider via its `:on` toggle and re-importing.
Track: "Eye In The Sky" (spotify:track:2sIbHjfJ3nbMXNz4w03fWv).

| Entry        | Result                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `lrclib`     | **Verified** — default path, 9 lines rendered.                                                        |
| `spotify`    | **Verified** — "Lyrics provided by Spotify", 8 lines.                                                 |
| `musixmatch` | **Verified** — full credits footer resolved on the bundled token, 8 lines.                            |
| `local`      | **Verified** — stored lyric for the playing uri rendered through the registry.                        |
| `netease`    | No result for this Western track (service coverage, not a crash) — excluded per the minimum-bar rule. |
| `genius`     | Version-gated off on >= 1.2.31 (the client gate in mod.tsx) — not applicable.                         |

Minimum bar (spotify + two others + local): **met**. Provider toggles and
services-order restored to the pre-sweep snapshot afterwards.
