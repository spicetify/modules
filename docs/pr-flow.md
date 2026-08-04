# PR flow: enabling branch protection and the merge queue

The release machinery is already PR-flow-ready: the version-bump gate runs hard in `pull_request` and `merge_group` checks, and the release workflow publishes whatever bump lands on `main` regardless of how it got there. Flipping the repo from direct pushes to PR flow is a repository-settings change, not a code change — deliberately kept as a one-command act for when v3 is fully live.

## What the flip changes

- Direct pushes to `main` are rejected; changes land through PRs via the merge queue.
- The `Verify` check (ci.yml) is required, so a PR that changes a module without bumping its version cannot merge — the version-bump gate moves from post-hoc warning to pre-merge enforcement.
- Merge becomes the release act: the queue validates, the merge lands change and bump together, and the release workflow publishes.
- The GitHub Actions app keeps a bypass so the release workflow's vault commits to `main` continue to work under protection.

## Enable

```shell
gh api repos/spicetify/modules/rulesets --method POST --input .github/rulesets/main-merge-queue.json
```

Verify after enabling:

1. A direct push to `main` is rejected.
2. A PR without a bump for a changed module shows a failing required `Verify` check and cannot merge.
3. A merged PR carrying a bump auto-publishes (tag, release, vault entry), and the vault commit from the workflow lands on `main` — this is the bypass working; if it is rejected, check that the ruleset's `bypass_actors` entry covers the GitHub Actions integration (`actor_id` 15368).

## Roll back

```shell
gh api repos/spicetify/modules/rulesets --jq '.[] | "\(.id) \(.name)"'
gh api "repos/spicetify/modules/rulesets/<id>" --method DELETE
```

Direct pushes work again immediately; the release workflow is unaffected either way.

## Recovery notes

- **A failed publish leg cancels the queued legs behind it** (fail-fast protects dependents). After fixing the cause, re-run the failed workflow run — publishes are idempotent — or trigger the Release workflow manually (`workflow_dispatch`) to re-detect everything still pending.
- **A stale tag at another commit** (e.g. a manual `tag --push` whose run failed) hard-fails that module's auto-publish as a racing tag. Re-run the original failed run, or delete the stale tag, then re-trigger Release.
