# Coinage Conversion Macro — Design

**Date:** 2026-08-06
**Module id:** `dark-sun-essentials`
**Target:** Foundry VTT v13 + v14, dnd5e 5.3.x
**Builds on:** [2026-08-03-dark-sun-essentials-design.md](2026-08-03-dark-sun-essentials-design.md)

## Problem

The conversion still works. It lost its front door.

`migration.mjs` converts world actors, carried items, sidebar items and unlinked
tokens, and `main.mjs` exposes it as
`game.modules.get("dark-sun-essentials").api.openMigrationDialog()`. But v1.2.0
removed the settings window that held the button, so the only discoverable
trigger left is the `removeLegacyCurrency` toggle, which fires the dialog as a
guard. A GM who wants to convert balances *without* deleting the standard coins
has no visible path to it.

Two things follow: give the conversion a shipped entry point, and extend it to
the compendium packs it currently counts and skips.

## What ships

A `Macro` compendium, `packs/dark-sun-macros`, holding one macro — *Convert to
Athasian Coinage*:

```js
game.modules.get("dark-sun-essentials").api.openMigrationDialog();
```

The macro is a deliberate shim. All logic stays in the module, so a macro a GM
dragged into their world in v1.3 still picks up v1.4's fixes.

## Scope of the conversion

| Target | Operation | Default |
|---|---|---|
| World actors, carried items, sidebar items, unlinked tokens | as today | always included |
| Unlocked **Actor** packs | currency conversion | one checkbox per pack, unticked |
| Unlocked **Item** packs | price conversion | one checkbox per pack, unticked |
| Locked packs | none | counted and reported, as today |

Actor packs are in scope because they carry the same exposure as world actors:
removing the standard coins drops those fields from the schema, and a stored
NPC's balance becomes unreadable. Item packs carry only prices, which is
cosmetic by comparison — but the same dialog covers both, so both are offered.

Packs are opt-in per pack rather than in bulk. "Unlocked" means the GM is free
to edit it, not that they consented to a rewrite; a pack left unlocked from
unrelated editing must not be caught in a sweep.

## Architecture

- `core/coinage.mjs` — **unchanged.** The arithmetic is correct and tested, and
  it is already idempotent: `convertPrice` returns null for any denomination
  outside `PRICE_MAP`, and `convertLegacyToCeramic` zeroes the legacy coins
  while folding in whatever ceramic is already held. A second run over a pack
  finds nothing to do.
- `migration.mjs` — **unchanged.** It stays the world-data unit: synchronous,
  reading `game.actors` / `game.items` / `game.scenes`.
- `pack-migration.mjs` — **new.** Packs are asynchronous, per-pack, and fail
  differently from world documents. Folding them into `migration.mjs` would push
  that file past 300 lines and mix two failure models in one place. Exports
  `scanPacks()` and `applyPackMigration(selection)`.
- `apps/migration-dialog.mjs` — awaits both scans and renders the checkbox list.

### The scan reads the index, not the documents

This decides whether the feature feels broken. Calling `getDocuments()` on every
unlocked pack merely to render a dialog can stall a GM with a large homebrew
pack.

- **Scan:** `pack.getIndex({ fields: ["system.price", "system.currency"] })` —
  enough to count candidates, without loading documents.
- **Apply:** `getDocuments()` only on the packs actually ticked.

## Data flow

1. Dialog opens.
2. `scanWorld()` runs synchronously, as now; `await scanPacks()` runs alongside.
3. The dialog renders the existing world summary, plus one unticked checkbox per
   unlocked Actor/Item pack showing its label and candidate count.
4. The GM confirms.
5. World writes commit first, then each ticked pack in turn.
6. One combined report.

Both entry points share this dialog, so the `removeLegacyCurrency` guard offers
pack conversion too. That is the case that most needs it: removal is precisely
what orphans a stored NPC's balance.

## Error handling

`applyPackMigration` reuses the `attempt()` shape from `applyMigration`:
per-pack try/catch, errors collected rather than thrown, one bad pack unable to
abort the rest. Failures surface in the existing errors dialog.

Lock state is re-checked at apply time. A GM can lock a pack between the scan
and the confirmation, and a write to a locked pack must be skipped and reported,
not attempted.

## Undo

None, beyond a warning line in the dialog telling the GM to back the world up.

The dialog shows counts before it writes, the pack checkboxes are opt-in and
start unticked, and the conversion is idempotent. A JSON export/re-import path
would be a meaningful chunk of new code and a second failure mode — a large
export that truncates or never downloads is worse than no export, because it
looks like a safety net.

## Build and release

The module currently ships raw files with no build step. A compendium changes
that.

- `@foundryvtt/foundryvtt-cli` as a devDependency.
- Macro source as YAML under `packs/src/`, human-readable and diffable.
- `npm run build:packs` compiles it to the LevelDB pack at `packs/dark-sun-macros`.
- Source is committed; the built pack is gitignored and built by the release
  workflow.
- `module.json` gains the `packs` entry, with ownership `{"PLAYER": "NONE",
  "ASSISTANT": "NONE"}` — the macro rewrites world data and belongs to the GM.
- The rsync deploy to the Pi now needs a build first. `CLAUDE.md` gets that step.

## Testing

- `scanPacks` and `applyPackMigration` get unit tests against stubbed packs —
  fake `getIndex`, `getDocuments`, and `locked` — in the style of the existing
  suite. No Foundry required.
- The manifest test asserts the `packs` declaration only, not the built
  artifact, which does not exist in a fresh clone.
- Functional verification happens on the Pi install, per `CLAUDE.md`. Nothing
  here proves the dialog renders.

## Out of scope

- JSON export or any undo mechanism.
- Reinstating the settings window removed in v1.2.0.
- Pack conversion in the world-script edition. A world script cannot ship a
  compendium; `convertCurrency()` there keeps its world-data scope, and
  `world-script/README.md` gains a line saying so.
