# Dark Sun Essentials

A Foundry VTT module that makes three Athasian changes to a D&D 5e world:
ceramic coinage, the Psionic spell school, and material properties for weapons
and armour.

Every change is a toggle. Turn them all off and the world behaves exactly like
stock dnd5e.

**Foundry:** v13 and v14 · **System:** dnd5e 5.3.x

## What it does

### Athasian coinage

Adds three currencies alongside the standard five:

| Coin | Worth |
|---|---|
| Ceramic Token (ct) | 1 gp |
| Ceramic Bit (cb) | 1 sp |
| Lead Bead (lb) | 1 cp |

These are real currency fields, not relabelled gold — they persist on actors,
work as item price denominations, and appear on character sheets. Once enabled,
new items are priced in ceramic by default.

A second toggle removes platinum, gold, electrum, silver and copper entirely.
Because that drops them from every actor's stored data, it will not proceed
without offering to convert existing balances first.

### Conversion is exact

| From | To |
|---|---|
| 1 pp | 10 ct |
| 1 gp | 1 ct |
| 1 ep | 5 cb |
| 1 sp | 1 cb |
| 1 cp | 1 lb |

Nothing rounds and nothing is lost. Electrum is the only standard coin without
a 1:1 ceramic partner, and it lands cleanly: half a gold piece is five ceramic
bits.

The migration covers world actors, the items they carry, sidebar items, and
unlinked tokens on scenes. It is safe to run more than once — the second run
finds nothing to do.

Compendium packs are **not** converted. System packs are locked, and rewriting
them would be undone by the next system update. The migration tells you how
many packs it skipped rather than pretending they aren't there.

### Psionic spell school

Adds Psionic as a ninth school. Psionic powers can then be filtered in the
compendium browser, sorted on spell lists, and referenced by enrichers — the
long form `psionic` works as well as the key `psi`.

### Material properties

Adds Wood, Bone, Stone, Obsidian and Metal as properties on weapons and armour.

These are descriptive tags. They render on item sheets, filter in the compendium
browser, and are readable by macros via `item.system.properties`. They carry no
combat automation, deliberately — hooking the attack pipeline for obsidian
breakage is the change most likely to break on a system update and to collide
with Midi-QOL, and your table can adjudicate a snapped bone spear faster than an
automation can.

Materials are not mutually exclusive. A bone-hafted obsidian blade is a real
Athasian object.

## Installation

Paste this manifest URL into Foundry's *Install Module* dialog:

```
https://raw.githubusercontent.com/ctbritt/foundry-dark-sun-essentials/main/module.json
```

Then enable the module and open **Configure Athas** from Module Settings.

## Notes

**Settings require a reload.** dnd5e builds its data model from configuration
the first time a document is touched in a session, so a currency added
mid-session would exist in the config table but not in any actor's schema.
Foundry will prompt for the reload.

**Back up before removing the standard coins.** The conversion is exact and
tested, but it rewrites actor data, and no in-Foundry undo exists.

**Compatibility with dnd5e 6.0 is untested.** At the time of writing, 6.0 has
not been released — dnd5e `master` is 5.3.3, and the 5.3 release notes describe
it as the v14-compatibility release laying foundations for 6.0. This module
declares no maximum system version, so 6.0 will not be blocked, and it verifies
every configuration point it writes to at startup: if the system has moved one,
the module disables that feature, names what it could not find in the console,
and tells the GM, rather than corrupting data. That is defensive design, not
tested support.

## Development

The coin arithmetic lives in `scripts/core/`, which imports no Foundry globals
and is covered by tests that run without a world:

```
npm test
```

`scripts/` outside `core/` is the Foundry adapter — settings, config
application, the migration, and the ApplicationV2 windows. The split exists so
the part that can lose a player's money is testable, and so a future system
change is confined to the adapter.

The design document is in `docs/superpowers/specs/`.

## Licence

MIT.
