# spicetify modules

V3 modules for the spicetify modular runtime.

## Building (stitch)

Modules are built with **stitch** (`scripts/stitch.ts`), a thin builder on
top of [rolldown](https://rolldown.rs). Node 24 only; no Deno required, and
TypeScript runs natively.

```shell
pnpm install
pnpm stitch modules/stdlib        # one module, auto-detects the classmap
pnpm stitch                       # all modules
pnpm stitch --classmap 1020092    # explicit classmap key
pnpm stitch -c path/to/classmap.json
pnpm stitch --help
```

Classmap resolution order (no env vars needed):

1. `--classmap <key|path>`: a key resolves to the newest `classmap-*.json`
   in that folder of a classmaps checkout; a path is used directly.
2. `stitch.config.json` (repo-level defaults, gitignored).
3. Auto-detection: the newest key folder in `../classmaps` (sibling clone)
   or `./classmaps` (in-repo, used by CI).
4. `./classmap.json` as a fallback.

What stitch does:

- bundles TS/TSX with rolldown (lazy dynamic-import chunks preserved,
  `/hooks/*` and `https://` imports kept external),
- compiles `index.scss` to `index.css` (sass-embedded),
- writes `dist/<name>@<version>/` with `metadata.json` and the
  `spicetify-module.json` sidecar (`classmap_base`, `installed_version`,
  `allow_stale`),
- generates `classmap.d.ts` per module from the resolved classmap (typed
  `MAP` for authors).

Modules ship **MAP-intact**: class references stay as `MAP.*` in the built
output and are remapped by the spicetify CLI at apply time against the exact
installed classmap. One build serves every supported Spotify version; there
are no per-version prebuilds.

## Docs

- [`docs/authoring-guide.md`](docs/authoring-guide.md) — building a module
- [`docs/module-standard.md`](docs/module-standard.md) — the module contract
- [`docs/publishing.md`](docs/publishing.md) — submitting a module to the store
- [`docs/theming-the-client.md`](docs/theming-the-client.md) — theming the
  client's own colors
- [`docs/pr-flow.md`](docs/pr-flow.md) — release and tag recovery

## Why Node and not Deno

The 2024 prototype was Deno-first (TS-native execution, JSR, web-standard
APIs). Everything the current pipeline needs, Node 24 does natively: type
stripping, rolldown (Rust bundler with TS support), and the package
ecosystem the rest of spicetify already uses (the CLI wrapper builds with
esbuild on Node). The Deno/tailor tooling was removed; stitch is the only
build path.

## License

GPLv3. See [COPYING](COPYING).
