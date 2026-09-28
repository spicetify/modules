# @spicetify/kit

The developer kit for [Spicetify](https://spicetify.app) v3 modules. It scaffolds a module, builds it, and hot-pushes every save into a running Spotify client.

## Requirements

- Node 22.6 or newer.
- Spotify with Spicetify v3 applied (`spicetify apply`). The kit pushes into the client the Spicetify CLI has patched, so a stock Spotify cannot load a pushed module.
- The standalone Spotify install. The Microsoft Store build cannot be started with a debug port.

## Start a module

```sh
npm create spicetify-module my-module
cd my-module
npm install
npm run dev
```

`npm run dev` starts Spotify with a remote debugging port, or reuses a client already running with one. It then rebuilds on every save and pushes the build into the client in about a second, with no re-apply and no restart. Stop it with ctrl-c, which removes the pushed copy so Spotify goes back to whatever version of the module is installed.

Pick a template with `--template`:

| Template          | What you get                            |
| ----------------- | --------------------------------------- |
| `basic` (default) | a topbar button that opens a page       |
| `extension`       | behaviour only, with no UI              |
| `app`             | a sidebar entry and a full page         |
| `theme`           | CSS and `color.ini` only, no TypeScript |

## Scripts in a scaffolded project

| Script           | What it does                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`    | start Spotify, then rebuild and hot-push on every save                                                                               |
| `npm run build`  | build once into `dist/`                                                                                                              |
| `npm run check`  | typecheck and audit the module against the [module standard](https://github.com/spicetify/modules/blob/main/docs/module-standard.md) |
| `npm test`       | run the unit tests in `test/`                                                                                                        |
| `npm run remove` | remove a pushed copy that is still installed in the client                                                                           |

`dev` flags go after `--`, for example `npm run dev -- --keep`:

| Flag          | Effect                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| `--keep`      | leave the pushed copy installed when `dev` stops                          |
| `--once`      | build and push once, then exit; the pushed copy stays                     |
| `--no-launch` | do not start Spotify; wait for one started with `--remote-debugging-port` |
| `--port <n>`  | use another debug port (default 9229, or `SPICETIFY_CDP_PORT`)            |

## Troubleshooting

**"port 9229 is already in use by ..., not Spotify"**: Node's inspector also defaults to 9229, so `node --inspect` or `wrangler dev` can hold it. Stop that process, or use another port with `npm run dev -- --port 9230`.

**"the v3 loader is not staged in this client"**: Spotify is running without Spicetify v3. Run `spicetify apply`, then start `dev` again.

**The UI still shows the old build**: a surface that was already on screen keeps the old code until it remounts. Navigate away from it and back.

## Commands

`spicetify-kit <command> --help` prints each command's flags.

| Command                | What it does                                                   |
| ---------------------- | -------------------------------------------------------------- |
| `create <name>`        | scaffold a module project                                      |
| `dev <module>`         | watch, rebuild, and hot-push into Spotify                      |
| `build [module...]`    | bundle modules into `dist/`                                    |
| `check [module]`       | audit a module against the module standard                     |
| `remove <dir\|id>`     | remove a pushed copy from the running client                   |
| `install <zip\|dir>`   | push a packed or built module into the running client once     |
| `pack <dist-dir>`      | zip a built module and print its sha256                        |
| `vault add <dist-dir>` | write the store registry entry for a release                   |
| `from-theme <dir>`     | convert a classic `user.css` and `color.ini` theme to a module |

## Learn more

- [Building a module](https://github.com/spicetify/docs/blob/v3/src/content/docs/development/building-a-module.md)
- [Authoring guide](https://github.com/spicetify/modules/blob/main/docs/authoring-guide.md)
- [Publishing to the store](https://github.com/spicetify/modules/blob/main/docs/publishing.md)

## License

GPL-3.0-or-later
