# spicetify modules

V3 modules for the spicetify modular runtime.

## Building (stitch)

Modules are built with **stitch** (`scripts/stitch.mjs`), a thin builder on
top of [rolldown](https://rolldown.rs). Node 22+ only; no Deno required.

```shell
nub install
CLASSMAP_KEY=1020094 nub run stitch modules/stdlib   # one module
CLASSMAP_KEY=1020094 nub run stitch                  # all modules
```

What stitch does:

- bundles TS/TSX with rolldown (lazy dynamic-import chunks preserved,
  `/hooks/*` and `https://` imports kept external),
- compiles `index.scss` to `index.css` (sass-embedded),
- writes `dist/<name>@<version>/` with `metadata.json` and the
  `spicetify-module.json` sidecar (`classmap_base`, `installed_version`,
  `allow_stale`),
- optionally generates `classmap.d.ts` per module when `CLASSMAP_JSON`
  points at a classmap file (typed `MAP` for authors).

Modules ship **MAP-intact**: class references stay as `MAP.*` in the built
output and are remapped by the spicetify CLI at apply time against the exact
installed classmap. One build serves every supported Spotify version; there
are no per-version prebuilds.

## Why Node and not Deno

The 2024 prototype was Deno-first (TS-native execution, JSR, web-standard
APIs). Everything the current pipeline needs, Node 24 does natively: type
stripping, rolldown (Rust bundler with TS support), and the package
ecosystem the rest of spicetify already uses (the CLI wrapper builds with
esbuild on Node). Deno remains only for the legacy tailor-based tasks in
`deno.json`, kept for reference; stitch is the build path.

## Legacy tasks (Deno + tailor)

The `deno.json` tasks (`cm:fetch`, `sh:build`, `build:release`) use
[tailor](https://jsr.io/@delu/tailor) and the frozen 2024 flow. They still
work, but stitch output is what the CLI's staging consumes natively.

## License

GPLv3. See [COPYING](COPYING).
