# Publishing the npm packages

The repository publishes two public npm packages:

- `@spicetify/kit` owns the CLI, checker, builder, and scaffolding implementation.
- `create-spicetify-module` is the small `npm create`/`npx` launcher that delegates to the kit.

The launcher does not need a release for every compatible kit change. Release Please's Node workspace plugin updates and
releases it when its wrapper changes or when a new kit version falls outside the declared dependency range.

## Bootstrap status

Both `0.1.0` packages were published manually because npm cannot configure a package-level trusted publisher before the
package exists. Their initial versions are recorded in [`.release-please-manifest.json`](../.release-please-manifest.json).
The bootstrap commit in [`release-please-config.json`](../release-please-config.json) keeps earlier repository history out of
the first generated changelog.

For reference, the manual bootstrap used Node 24 and these commands:

```sh
command pnpm install --frozen-lockfile
command pnpm --dir packages/kit test
command pnpm publish ./packages/kit --dry-run --no-git-checks
command pnpm publish ./packages/create-spicetify-module --dry-run --no-git-checks

npm login
command pnpm publish ./packages/kit --no-git-checks
command pnpm publish ./packages/create-spicetify-module --no-git-checks
```

`command` bypasses any shell wrapper named `pnpm` and runs the pnpm CLI. `--no-git-checks` is intentional for this
repository: generated or local-only untracked files can make pnpm reject an otherwise committed release. Package contents
are still inspected by the dry run first. The package manifests set `publishConfig.access` to `public`, including for the
scoped kit.

## Connect npm to GitHub OIDC

Create a protected GitHub environment named `npm`. Requiring a maintainer approval on that environment adds a deliberate
release gate without placing an npm token in GitHub.

With npm 11.5.1 or newer, configure the same trusted workflow for both packages:

```sh
npm trust github @spicetify/kit \
  --repo spicetify/modules \
  --file npm-publish.yml \
  --env npm \
  --allow-publish

npm trust github create-spicetify-module \
  --repo spicetify/modules \
  --file npm-publish.yml \
  --env npm \
  --allow-publish
```

The equivalent npmjs.com settings are:

- provider: GitHub Actions
- organization: `spicetify`
- repository: `modules`
- workflow filename: `npm-publish.yml`
- environment: `npm`
- allowed action: `npm publish`

Each package can have only one trusted publisher. The repository and workflow filename must match exactly.

After one successful OIDC release, set each package's npm **Publishing access** to **Require two-factor authentication and
disallow tokens**, then revoke any automation publishing token. OIDC publishing continues to work because it uses a
short-lived workflow identity rather than an npm token.

## Automated releases

[`npm-publish.yml`](../.github/workflows/npm-publish.yml) runs Release Please in manifest mode on every push to `main`.
Conventional commits under a package path determine its next version:

```sh
fix(kit): correct generated configuration       # patch
feat(kit): add a module authoring command        # minor
feat(kit)!: remove a command                     # major
```

Release Please maintains one combined release PR. That PR updates package versions, package changelogs, the manifest, the
kit version embedded in generated projects, and any launcher dependency that needs to move. Merging it creates the GitHub
release(s), then the same workflow verifies and publishes the affected package(s) through OIDC. If both packages release,
the kit is always published first. npm adds provenance automatically for public packages published from this repository.

The kit vendors the stdlib authoring surface. When bumping `modules/stdlib/metadata.json`, also update
`packages/kit/package.json` → `spicetify.stdlibVersion`. That package-local provenance change makes the kit part of the
release PR, and prepack refuses to publish when the two versions disagree.

There are no manual version edits or tag pushes. Review and merge the generated release PR when its CI passes, then approve
the protected `npm` environment deployment if approval is enabled.

### Repository setting

Under **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull
requests**. Release Please uses the scoped `GITHUB_TOKEN`; no PAT is required. GitHub suppresses recursive workflow events
created by that token, so the release workflow explicitly dispatches `ci.yml` for the generated PR branch.

The publish job runs on Node 24, disables dependency caching, has only `contents: read` and `id-token: write`, and receives
the `npm` environment only when Release Please has actually created a release.
