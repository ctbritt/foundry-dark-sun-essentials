# Dark Sun Essentials — Design

**Date:** 2026-08-03
**Module id:** `dark-sun-essentials`
**Target:** Foundry VTT v13 + v14, dnd5e 5.3.x (defensive support for 6.0)

## Purpose

Convert a stock dnd5e world into an Athasian one along three axes: coinage,
psionics, and the materials weapons and armor are made from. Every change is a
toggle. A GM who turns everything off gets a world indistinguishable from
vanilla dnd5e.

## What the system already gives us

Research against `foundryvtt/dnd5e@release-5.3.3` established that all three
changes land on supported, dynamic extension points. None of this requires
monkey-patching.

| Feature | Extension point | Why it works |
|---|---|---|
| Coinage | `CONFIG.DND5E.currencies` | `CurrencyTemplate` (`module/data/shared/currency.mjs:13`) builds `system.currency` as a `MappingField` with `initialKeys: CONFIG.DND5E.currencies, initialKeysOnly: true`. Adding a key creates a real, persisted coin field. |
| Item prices | `system.price.denomination` | An unconstrained `StringField` (`module/data/item/templates/physical-item.mjs:38`) whose initial value is `() => CONFIG.DND5E.defaultCurrency`. New denominations need no patching. |
| Spell schools | `CONFIG.DND5E.spellSchools` | Plain config enum (`module/config.mjs:3289`), localized lazily via `preLocalize`. |
| Item properties | `CONFIG.DND5E.itemProperties` + `CONFIG.DND5E.validProperties` | Resolved at runtime by a getter — `new Set(CONFIG.DND5E.validProperties[this.parent.type] ?? [])` (`module/data/item/templates/item-description.mjs:39`). Nothing is frozen at schema-definition time. |

Two behaviours matter for the removal path:

- `preparePhysicalData()` early-returns when `CONFIG.DND5E.defaultCurrency` is
  not present in `CONFIG.DND5E.currencies` (`physical-item.mjs:187`). Removing
  `gp` without reassigning `defaultCurrency` silently kills all price
  conversion.
- `priceLabel` guards on `denomination in CONFIG.DND5E.currencies`
  (`physical-item.mjs:94`). Items priced in a removed coin display no price at
  all rather than throwing.

Both are handled explicitly rather than relied upon.

## Architecture

A pure core with a thin Foundry adapter around it.

```
scripts/
  core/           no Foundry globals; unit-tested with node:test
    coinage.mjs     currency definitions + exact conversion math
    properties.mjs  shared itemProperties/validProperties merge semantics
    materials.mjs   material property definitions
    psionics.mjs    psionic school + psionic item property
    vehicles.mjs    silt vehicle type
    constants.mjs   module id, setting keys, item type lists
  compat.mjs      version detection, extension point verification
  settings.mjs    game.settings registration
  config-apply.mjs  mutates CONFIG.DND5E from settings
  migration.mjs   world data conversion
  apps/
    migration-dialog.mjs  DialogV2 confirmation and report
  main.mjs        hook wiring
```

The split exists so the part most likely to be wrong — the coin arithmetic —
can be tested without booting Foundry, and so a future dnd5e 6.0 break is
confined to the adapter.

## Coinage

Three new currencies are added alongside the standard five:

| Coin | Key | Conversion | Equivalent |
|---|---|---|---|
| Ceramic Token | `ct` | 1 | gp |
| Ceramic Bit | `cb` | 10 | sp |
| Lead Bead | `lb` | 100 | cp |

`conversion` is dnd5e's "how many of this coin equal one gp", so these values
mirror gp/sp/cp exactly. When ceramic currency is enabled,
`CONFIG.DND5E.defaultCurrency` becomes `ct`. Because `ct.conversion === gp.conversion`,
this changes no price arithmetic; it only changes which coin new items default to.

### Conversion is exact

Legacy balances convert into ceramic with no rounding and no loss:

```
CT += pp × 10 + gp
CB += ep × 5  + sp
LB += cp
```

Electrum is the only coin that does not map to a ceramic denomination 1:1, and
it lands cleanly: 1 ep = ½ gp = 5 sp = 5 cb. The implementation derives this
generically from each currency's `conversion` value rather than hard-coding the
table, so homebrew currencies convert correctly too. It computes a common base
in lead beads (`amount / conversion × 100`), then distributes greedily into
ct/cb/lb. A currency whose value does not divide evenly into lead beads is
reported as a remainder rather than silently truncated.

### Removing legacy coinage

`initialKeysOnly: true` means dropping a key from `CONFIG.DND5E.currencies`
removes it from the schema. Stored values for that key become unreadable and
are purged on the next write. This is destructive, so the removal toggle is
gated:

1. Enabling `removeLegacyCurrency` opens a `DialogV2` describing exactly what
   will change and how many documents are affected.
2. The migration runs first: every world Actor (including unlinked tokens in
   scenes) has its balances converted, and every world Item priced in a legacy
   denomination is repriced into the ceramic equivalent.
3. Only then is the setting written and a world reload requested.

Compendium packs are **not** touched. System compendiums are locked and
rewriting them would break on the next system update. The migration reports how
many compendium documents it skipped rather than pretending they don't exist.

The migration is idempotent — running it twice converts nothing the second
time, because legacy balances are zeroed as they are folded in.

## Psionics

Two independent features, in `core/psionics.mjs`.

**The school.** Adds a `psi` school to `CONFIG.DND5E.spellSchools` with
`fullKey: "psionic"`, matching the `SpellSchoolConfiguration` shape (label,
icon, fullKey, optional reference). The `fullKey` makes `@Spell[psionic]`-style
enrichers resolve. Ships its own SVG icon rather than borrowing a system path
that may move.

**The property.** Adds a `psi` entry to `CONFIG.DND5E.itemProperties`,
registered in `validProperties` for `spell`, `weapon`, `equipment`, `consumable`
and `feat`.

The two are not redundant. The school answers *what kind of magic is this
power*, a question only spells have. The property answers *is this thing psionic
at all*, which a wild talent, a mind-forged blade, a psionic focus and a brewed
draught all raise, and only the first of those is a spell. Restricting the
property to spells would have made it a second spelling of the school.

The key is shared between the two tables deliberately. They are separate tables,
so there is no collision, and one spelling of "psionic" in stored data is worth
more than the marginal clarity of two keys. `isPhysical` is unset for the same
reason as the materials: it means "bypasses damage resistance", and this module
tags things rather than adjudicating them.

## Materials

Adds five properties — `wood`, `bone`, `stone`, `obsidian`, `metal` — to
`CONFIG.DND5E.itemProperties`, and registers each in
`CONFIG.DND5E.validProperties.weapon` and `.equipment` (dnd5e models armor as
`equipment`).

They are tags. They render on item sheets, filter in the compendium browser,
and are readable by macros and other modules via `item.system.properties`. They
carry no combat automation: hooking the attack pipeline for obsidian breakage
is the change most likely to break under dnd5e 6.0 and to conflict with
Midi-QOL, and the table can adjudicate a shattered bone spear faster than an
automation can.

Materials are not mutually exclusive. A bone-hafted obsidian blade is a real
Athasian object.

## Settings

| Key | Type | Effect |
|---|---|---|
| `ceramicCurrency` | boolean | Add CT/CB/LB, set `defaultCurrency` to `ct` |
| `removeLegacyCurrency` | boolean | Remove PP/GP/EP/SP/CP (gated on migration) |
| `psionicSchool` | boolean | Add the Psionic spell school |
| `psionicProperty` | boolean | Add the Psionic item property |
| `materialProperties` | boolean | Add the five material properties |
| `siltVehicles` | boolean | Add Silt as a vehicle type |

All are world-scoped, GM-only, and `requiresReload: true` — CONFIG is read when
data model schemas are first built, so changes cannot take effect mid-session.

They register with `config: true` and appear directly in Foundry's module
settings list. There is no separate configuration window: six checkboxes do not
need one, and a second surface holding the same state is a second place for it
to drift.

Converting balances *without* removing the standard coins is therefore an API
call — `game.modules.get("dark-sun-essentials").api.openMigrationDialog()` — not
a button. The path that actually risks data is unchanged: enabling
`removeLegacyCurrency` still scans the world and offers the migration first, and
if ceramic coinage is not enabled it now switches the setting back off rather
than leaving it armed to fire on a later reload.

## Timing

All CONFIG mutation happens in `Hooks.once("init")`. The system's own `init`
runs first, and dnd5e's data model schemas are built lazily on first access —
after `init` completes. Settings are registered before config is applied, in
the same hook.

## Compatibility

**v13 / v14.** The relevant APIs — `game.settings.register`,
`foundry.applications.api.DialogV2`, `foundry.utils.*` — are present and stable
in both. The module ships no Handlebars templates, so the v14 removal of the
deprecated `loadTemplates` / `renderTemplate` globals does not touch it.

**dnd5e 6.0.** It does not exist yet. dnd5e `master` is 5.3.3, and the 5.3
release notes describe it as the V14-compatibility release "laying solid
foundations for the ambitious changes planned for version 6.0". Claiming tested
6.0 support would be a lie. Instead:

- `module.json` declares no `maximum` system version, so 6.0 will not be blocked.
- Every extension point is verified at `init` before it is written to. If
  `CONFIG.DND5E.currencies`, `.spellSchools`, `.itemProperties`, or
  `.validProperties` is missing or has changed shape, the module logs a specific
  warning naming the missing point, notifies the GM once, and disables that
  feature rather than corrupting data.
- The README states plainly that 6.0 is untested.

## Testing

`node:test` (no dependencies) covers the pure core:

- Every legacy coin converts at the documented rate.
- Conversion is exact for all five legacy coins — no remainders.
- Conversion is idempotent.
- Mixed hoards sum correctly; existing ceramic balances are preserved.
- Malformed input (negatives, floats, strings, null) is coerced safely.
- The generic conversion agrees with the hand-written table for standard coins.
- Config builders produce the shapes dnd5e's typedefs document.
- Materials and the psionic property compose: both write to `itemProperties`
  and `validProperties`, and enabling both must leave a weapon able to carry
  `obsidian` and `psi` at once. This is the only failure mode invisible with a
  single feature enabled, so it is asserted at both the core and adapter level.

The Foundry-coupled layer is verified by installing into the live v13 and v14
data directories and loading a world.

## Out of scope

Athasian races, classes, defiling/preserving, psionic power compendia, survival
rules, and templar spellcasting. This module is a settings layer, not a setting.
