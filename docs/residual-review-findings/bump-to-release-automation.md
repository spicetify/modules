# Residual review findings: bump-to-release automation

Source: independent code review of the 2026-08-04 bump-to-release implementation
(plan: workspace `docs/plans/2026-08-04-001-feat-bump-to-release-automation-plan.md`).
Applied fixes are in the feature commit; these are the accepted residuals.

- **M2 (partial)** — the shared `publish` concurrency queue holds one pending
  run; a queued release run cancelled by a newer manual publish leaves its
  remaining bumps unpublished until the next push. Mitigated with a
  `workflow_dispatch` re-trigger on release.yml; the cross-workflow
  cancellation itself remains.
- **M3** — publish ordering rides on matrix legs starting in `include` order
  under `max-parallel: 1`: observed GitHub behavior, not contractual.
  Documented in release.yml; revisit if GitHub ever reorders.
- **M4 (mechanism)** — a stale tag at another commit hard-fails its module and
  fail-fast cancels the queued siblings. Recovery documented in
  docs/pr-flow.md; a wedged-module quarantine mechanism was deferred.
- **L1** — release-notes previous-tag fallback for local pre-tag runs assumes
  the drafted release is the newest version; out-of-order backport windows
  would be wrong. Assumption pinned in a comment.
- **L4 (remainder)** — untested: merge commits in the notes window (matters
  once the merge queue's MERGE method is enabled), and topoOrder dependency
  resolution when directory id differs from metadata name.
