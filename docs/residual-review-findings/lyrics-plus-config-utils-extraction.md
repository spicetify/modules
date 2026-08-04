# Residual review findings — lyrics-plus config/utils extraction

Source: code review of `refactor/lyrics-plus-provider-extraction` (PR #3).
Blocking and high-value findings were applied in `a1f916f`; these were judged
not worth acting on inside a behaviour-preserving refactor and are recorded
rather than fixed.

## Not applied

- **LOW — missing-duration fallback changed shape.** `currentTrackDurationMs()`
  returns `Number(...) || 0`; the original passed the raw metadata string. With
  a duration present the two are identical. With it _absent_, the original
  yielded `formatTime(undefined)` → `"NaN:NaN"` → word `time: NaN`, and the new
  code yields `formatTime(0)` → `"00:00.00"` → `time: -10000`. Both are
  garbage, but they are different garbage. Left as-is: correcting it would be a
  behaviour change, which this refactor deliberately excludes.

- **LOW — the duration read is now eager.** The helper is evaluated at every
  `parseLocalLyrics` call site, where the original read the player lazily and
  only inside the karaoke fallback branch. Harmless (optional chaining plus
  `|| 0` cannot throw) but it adds one client read per LRCLIB parse.

- **LOW — duplicated prefix constant.** `getMusixmatchTranslationPrefix()` in
  `mod.tsx` re-implements the lookup and hardcodes `"musixmatchTranslation:"`,
  now a second source of truth against `config.ts`. `mod.tsx` already imports
  `MUSIXMATCH_TRANSLATION_PREFIX`, so the function can return it or be deleted.
  Predates this branch; folding it in belongs with the UI split.

- **Coverage gap — `formatTextWithTimestamps` has no direct test.** It is
  exercised transitively through `convertParsedToLRC`. Worth a direct case when
  the karaoke path is touched again.

## Carried into the plan instead

- **KTD5a** (workspace-root
  `docs/plans/2026-08-04-001-refactor-lyrics-plus-provider-extraction-plan.md`,
  alongside the other v3 plans — plans live in the workspace, not in this repo):
  U4 must not pass `info.duration` into LRCLIB. `componentDidMount` prefetches
  the _next_ track via `tryServices(nextInfo, …)`, so the registry would feed
  the wrong duration to the karaoke end-time fallback. This supersedes the
  registry-threading half of KTD5 and would very likely escape U5's live check.

## Deferred from the capture-safety work (2026-08-05)

- **D6 — staged-source freshness.** The manager compares nothing against the
  vault: a stale staged module (the incident's `stdlib 1.0.0`) is invisible
  until something breaks, and published fixes never reach an applied client
  without a manual refresh of `~/.config/spicetify/Modules`. Design sketch:
  the manager already loads the manifest of staged versions; fetch the vault
  (as the store's `catalog.ts` does), compare per module, and render a
  "staged X@a — Y@b published" row with refresh guidance. Deliberately not
  rushed: the manager is the recovery surface, and changes there deserve
  their own verified slice.
- **D5 — a truly capture-independent recovery surface.** The manager mounts
  through the React route overlay, so it died with everything else during the
  Fragment freeze despite the standard designating it the tool that must
  survive exactly that. With D1 the known trigger is gone and D4 makes any
  recurrence visible, so this dropped in urgency — but a vanilla-DOM fallback
  mount for the manager remains the correct completion of its reliability
  tier.
