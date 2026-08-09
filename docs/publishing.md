# Publishing: getting a module into the store

The store reads one registry: `vault.json` in this repository. Your code can
live wherever you like, but the entry that points at it is submitted here, so
every module in the store is reviewable, checksummed and revocable.

This doc is the submission path. The [authoring guide](./authoring-guide.md)
covers building a module and [the standard](./module-standard.md) is the
contract it has to meet.

---

## What the registry is

`vault/<id>.json` is the source, one file per module, so two submissions never
touch the same file and a review diff is the module being submitted and
nothing else. `vault.json` is the aggregate the store and the CLI fetch, built
from those files by `node scripts/vault-build.ts` and committed by CI after a
merge. Never edit it by hand: CI rejects an aggregate that does not match its
sources.

A module file looks like this:

```jsonc
{
	"metadata": {
		"name": "My Module",
		"description": "…",
		"authors": [{ "name": "…", "github": "…" }],
		"tags": ["extension"],
		"preview": "https://…/preview.png", // required: cards are artwork-first
		"repository": "https://github.com/you/my-module",
		"license": "MIT", // SPDX, shown on the card
	},
	"v": {
		"1.0.0": {
			"artifacts": ["https://…/my-module@1.0.0.zip"],
			"checksum": "sha256:…",
			"updatedAt": "2026-08-10",
		},
	},
}
```

Card data sits at the module level: one identity per module, however many
releases it carries. `enabled` pins a version; without it the highest wins.
`files` replaces `artifacts` for inline css snippets, and `hidden` marks
infrastructure (stdlib) that installs but never renders a card.

---

## Submitting

Build, pack, then open a pull request adding your entry.

```shell
spicetify-kit build                          # enforces the standard's error tier
spicetify-kit pack dist/my-module@1.0.0      # zips it and prints the sha256
# upload the zip to your own release, then:
spicetify-kit vault add dist/my-module@1.0.0 --artifact <url> --zip <file> --vault vault/my-module.json
```

Commit that one file and open the PR. Automate it from your own release
workflow with the publish action instead:

```yaml
- uses: spicetify/modules/.github/actions/submit@main
  with:
      dist: dist/my-module@1.0.0
      release-tag: ${{ github.ref_name }}
      # A token with public_repo scope on your account, used to push the
      # branch to your fork and open the PR. Omit it and the action prints
      # the entry for you to submit by hand.
      token: ${{ secrets.SPICETIFY_SUBMIT_TOKEN }}
```

Nothing the action computes is taken on trust. On the receiving side
`scripts/validate-submission.ts` downloads the artifact, re-hashes it, unpacks
it, and checks the entry against what is actually inside:

- the checksum matches the bytes, and the artifact is https
- `metadata.json` inside the artifact declares the same id and version as the
  entry, plus a `preview`, a `repository` and a `license`
- the card matches the artifact: an entry cannot describe something the code
  never claimed, or invent fields it does not declare
- the artifact was built by the toolchain (it carries `spicetify-module.json`)
- every dependency it names is already in the vault
- the zip holds no absolute paths, no `..` traversal and no symlinks
- **published versions are immutable**: an existing version cannot be
  rewritten or removed, and a new one must be higher than every published one
- **an id stays with the account that first published it**: later artifacts
  must come from the same owner as the first

Everything is checked before the merge, so a red check is a fix on your side,
not a conversation.

---

## Updating

Publish a new version the same way: build, pack, add the new version key. The
old ones stay exactly as they are. First admission gets a human review; after
that a green validator is the gate, because it proves mechanically everything
a reviewer would have checked by hand.

---

## What happens after the merge

1. CI rebuilds `vault.json` from the sources and commits it. That is when the
   module appears in the store.
2. Your artifact is downloaded, verified against its checksum, and copied to a
   `mirror/<id>` release in this repository, with the mirror URL appended to
   the entry. Installers walk `artifacts` in order, your host first, so an
   upstream asset that later disappears costs an attempt rather than every
   install of that version.

---

## CSS snippets

A stylesheet-only module can ship inline, with no artifact to host:

```shell
node scripts/vault.ts snippet <name> --css <file> --preview <url> \
  [--author <name>] [--github <user>] [--description <text>]
```

Inline entries install without a download, so they are restricted to `.css`
files. Executable code always arrives as a checksummed zip.

---

## Modules that live in this repository

Modules under `modules/` publish themselves: land a version bump on `main` and
the release workflow tags, releases, and writes the vault entry, in dependency
order. They inherit this repository's license rather than restating it in every
`metadata.json`. See [`pr-flow.md`](./pr-flow.md) for recovery when a publish
fails.

---

## Installing something that is not in the store

The store is the reviewed path, not the only one. Anything else installs
deliberately, through the CLI:

```shell
spicetify pkg install my-module https://example.com/my-module@1.0.0.zip
```

That bypasses the vault, so nothing verifies those bytes and the CLI says so.
For development, `spicetify-kit dev <module>` hot-pushes into a running client
in about a second and `spicetify-kit install <zip>` sideloads a packed build;
both are the dev loop rather than distribution.

---

## Things that catch people out

- **A missing `preview` makes a module invisible.** The store filters entries
  with no artwork out of the grid, with no card and no error. The validator
  rejects it first, but if a published module is missing from the store, check
  this before anything else.
- **`vault.ts add --check` validates the built artifact, not your source
  tree.** Rebuild after editing metadata or it reads a stale `dist/`.
- **Ship MAP-intact.** The CLI remaps `MAP.*` at apply time against the
  installed classmap, so one artifact serves every supported Spotify version.
  Never publish a per-version prebuild.
- **Pick an id you can keep.** Ids are global and permanent: the first
  submission binds the id to your account, and nothing else can publish it
  afterwards.
