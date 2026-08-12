# Publishing the npm packages

The repository publishes two public npm packages:

- `@spicetify/kit` owns the CLI, checker, builder, and scaffolding implementation.
- `create-spicetify-module` is the small `npm create`/`npx` launcher that delegates to the kit.

The launcher does not need a release for every kit change. Its `^0.1.0` dependency automatically selects newer compatible
kit releases. Publish the launcher again only when its wrapper, metadata, or kit compatibility range changes.

## Bootstrap the packages manually

npm cannot configure a package-level trusted publisher until the package exists. Publish `0.1.0` manually, in dependency
order, from a clean checkout using Node 24:

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

## Publish later versions

Bump and commit the relevant package version, let that commit land on `main`, then push the matching tag:

```sh
# @spicetify/kit 0.1.1
git tag npm-kit@0.1.1
git push origin npm-kit@0.1.1

# create-spicetify-module 0.1.1, only when the launcher itself changed
git tag npm-create-spicetify-module@0.1.1
git push origin npm-create-spicetify-module@0.1.1
```

[`npm-publish.yml`](../.github/workflows/npm-publish.yml) verifies that the tag matches `package.json`, refuses commits that
have not landed on `main`, runs on Node 24 without a dependency cache, tests and inspects the package, and publishes through
OIDC. npm adds provenance automatically for public packages published from this public repository.
