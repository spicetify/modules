# Standalone Spicetify Settings - Implementation Plan

## 1. Objective

Move module configuration out of Spotify's native Settings route and profile-menu popups into one standalone Spicetify Settings page. Render every registered setting inline and keep Module Manager as the final entry.

## 2. Tech Strategy

- **Pattern:** Registry-backed route with compatibility adapters.
- **State:** Existing module-owned React state remains local; stdlib owns only contribution ordering and lifecycle.
- **Constraints:** Keep `settingsRow` and `settingsSection` source-compatible, avoid new dependencies, and preserve registrar cleanup.
- **Counter-architecture:** Hosting settings inside Manager would reduce stdlib work, but would couple every module's configuration surface to an optional management app and make recovery failures remove settings too.

## 3. Blast Radius

- The stdlib settings registry stops patching Spotify's `/preferences` page and instead owns `/bespoke/settings`.
- Existing row and section contributors move automatically because their register names stay unchanged.
- Lyrics Plus replaces its route-mounted profile item and popup with a persistent settings contribution.
- Manager keeps the profile shortcut, redirects it to the settings route, and contributes the explicitly last navigation row.
- Authoring guidance and metadata versions change with the public behavior.

## 4. File Changes

| Action | Area                            | Purpose                                                                     |
| :----- | :------------------------------ | :-------------------------------------------------------------------------- |
| Modify | `modules/stdlib/src/registers/` | Render and order the standalone page; expose a reserved footer register.    |
| Modify | `modules/stdlib/index.scss`     | Give the page a bounded native-looking layout.                              |
| Modify | `modules/lyrics-plus/`          | Render its full configuration inline and remove route-owned menu lifecycle. |
| Modify | `modules/manager/`              | Open Spicetify Settings and add the last Manager entry.                     |
| Modify | Authoring docs and metadata     | Describe the new ownership model and publish compatible versions.           |
| Add    | Focused tests                   | Guard route separation, ordering, migration, and documentation.             |

## 5. Execution Sequence

1. Add failing contracts for the route, ordering helper, Lyrics Plus contribution, and Manager footer.
2. Implement the stdlib page while retaining raw registrar compatibility.
3. Migrate Lyrics Plus and Manager.
4. Update styling, docs, versions, and dependency ranges.
5. Run focused and full checks, then verify the live route and interactions through CDP.

## 6. Verification Standards

- [x] Spotify's `/preferences` page contains no injected Spicetify settings.
- [x] `/bespoke/settings` lists all simple rows and full sections without expansion.
- [x] Lyrics Plus settings exist before its lyrics route is visited.
- [x] Module Manager is the final entry and navigates correctly.
- [x] Unloading a contributing module removes only its settings.
- [x] Focused tests, full tests, typecheck, lint, formatting, and live CDP checks pass.
