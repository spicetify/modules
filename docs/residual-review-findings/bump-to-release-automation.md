# Residual review findings: bump-to-release automation

Source: independent code review of the 2026-08-04 bump-to-release implementation
(plan: workspace `docs/plans/2026-08-04-001-feat-bump-to-release-automation-plan.md`).
Applied fixes are in the feature commit; these are the accepted residuals.

- ~~**M2 (partial)**~~ **Closed by sweep (2026-08-05):** release.yml gained a daily `schedule` trigger, so displaced pending bumps self-heal within a day; `workflow_dispatch` remains the immediate lever. The cross-workflow queue displacement itself is GitHub semantics and remains. Original note: the shared `publish` concurrency queue holds one pending
  run; a queued release run cancelled by a newer manual publish leaves its
  remaining bumps unpublished until the next push. Mitigated with a
  `workflow_dispatch` re-trigger on release.yml; the cross-workflow
  cancellation itself remains.
- ~~**M3**~~ **Hardened (2026-08-05):** the release action's resolve step now enforces the invariant the ordering exists for - it refuses to publish a module whose vault dependencies are absent from origin/main's vault, so a reordering becomes a loud failure instead of silent inconsistency. The ordering itself still rides observed matrix behavior. Original note: publish ordering rides on matrix legs starting in `include` order
  under `max-parallel: 1`: observed GitHub behavior, not contractual.
  Documented in release.yml; revisit if GitHub ever reorders.
- ~~**M4 (mechanism)**~~ **Quarantine shipped (2026-08-05):** `release.ts pending` excludes a module whose tag exists at another commit (stderr warning, JSON contract untouched), so a wedged module no longer enters the matrix and cannot fail-fast its siblings. Pinned by fixture-repo tests in scripts/release-automation.test.mts; recovery unchanged (docs/pr-flow.md). Original note: a stale tag at another commit hard-fails its module and
  fail-fast cancels the queued siblings. Recovery documented in
  docs/pr-flow.md; a wedged-module quarantine mechanism was deferred.
- **L1 (accepted)** — no backport flow exists in this repo (bump-to-release from main only), so the fallback's assumption holds by construction. Original note: release-notes previous-tag fallback for local pre-tag runs assumes
  the drafted release is the newest version; out-of-order backport windows
  would be wrong. Assumption pinned in a comment.
- ~~**L4 (remainder)**~~ **Tested (2026-08-05):** fixture-repo tests cover topoOrder with directory id differing from metadata name, and merge commits in the notes window - release-notes.ts now passes --no-merges (a clean merge lists no files under git show, so the metadata-only filter could never catch it; the merged branch's own commits stay in the range). Original note: untested: merge commits in the notes window (matters
  once the merge queue's MERGE method is enabled), and topoOrder dependency
  resolution when directory id differs from metadata name.
