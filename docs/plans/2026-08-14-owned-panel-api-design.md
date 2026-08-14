# Owned Panel API - Implementation Plan

## 1. Objective

Replace stdlib's private Spotify panel-state mutation with a transform-free, Spicetify-owned right-sidebar surface and a typed module API.

## 2. Tech Strategy

- **Pattern:** Exclusive single-active-panel coordinator with per-registration controllers.
- **State:** Module-local registry plus one DOM host mounted in Spotify's right-sidebar grid slot.
- **Constraints:** No Spotify XState/chunk transforms; preserve and restore native sidebar DOM; one active custom panel; no new dependencies.
- **Blast radius:** `panel` register/API, registrar ergonomics, stdlib CSS/metadata, tests, and module-author documentation. Other registers and native panels remain untouched.

## 3. File Changes

| Action  | File Path                                         | Brief Purpose                                    |
| :------ | :------------------------------------------------ | :----------------------------------------------- |
| Rewrite | `modules/stdlib/src/registers/panel.ts`           | React adapter, registry, hot-replacement handoff |
| New     | `modules/stdlib/src/registers/panel-logic.ts`     | Owned coordinator, DOM lifecycle, controller API |
| Modify  | `modules/stdlib/src/registers/index.ts`           | Typed `registerPanel` registrar method           |
| Modify  | `modules/stdlib/index.scss`                       | Owned panel layout and responsive styling        |
| Modify  | `modules/stdlib/lib/{popover.ts,modal.tsx}`       | Top-layer Escape consumption                     |
| New     | `modules/stdlib/src/registers/panel.test.mts`     | State, DOM lifecycle, cleanup, focus tests       |
| New     | `modules/stdlib/src/registers/panel-api.test.mts` | Public API and source contracts                  |
| Modify  | `modules/stdlib/metadata.json`                    | Minor release                                    |
| Modify  | `packages/kit/package.json`                       | Current stdlib authoring target                  |
| Modify  | `scripts/settings-page.test.mts`                  | Current release-contract expectation             |
| Modify  | `docs/authoring-guide.md`                         | Public API usage and semantics                   |

## 4. Execution Sequence

1. Add failing state and DOM lifecycle tests.
2. Implement registration, exclusive open/close, and disposal.
3. Mount the owned host and suspend/restore native sidebar contents.
4. Add width clamping, close affordance, Escape handling, and focus restoration.
5. Expose `Registrar.registerPanel` and document the contract.
6. Build and E2E test against compact and expanded native sidebar states.

## 5. Verification Standards

- [ ] Focused state/DOM tests pass.
- [ ] Full stdlib and repository checks pass.
- [ ] Live custom panel opens at a clamped width and resizes the main view.
- [ ] Opening a second custom panel replaces the first deterministically.
- [ ] Close, Escape, unload, and hot replacement restore native content and grid geometry.
- [ ] No console errors or leaked DOM/style state remain.
