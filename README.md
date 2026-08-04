# Dark Sun Essentials

A Foundry VTT module that makes five Athasian changes to a D&D 5e world:
ceramic coinage, the Psionic spell school, a Psionic item property, material
properties for weapons and armour, and silt vehicles.

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
| Lead Bead (bd) | 1 cp |

The Lead Bead shows as **bd** rather than `lb`, which is dnd5e's abbreviation
for the pound — a sheet prints coin and carried weight inches apart, and `0 lb`
beside `10 lb` reads as one quantity written twice. Under the hood the coin is
still keyed `lb`, which is what balances and prices are stored as.

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

### Psionic item property

Adds Psionic as a property on powers, weapons, gear, consumables and features.

The school and the property answer different questions. The school says what
kind of magic a power is, which only spells have. The property says a thing is
psionic at all — and that gets asked about a wild talent, a mind-forged blade, a
psionic focus and a brewed draught as readily as about a power.

Like the materials, it is a descriptive tag with no automation, and it is not
marked resistance-piercing: tagging a blade psionic does not change what its
damage does. Toggled separately from the school, so you can take either alone.

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

### Silt vehicles

Adds Silt to the vehicle type list, for skimmers on the Sea of Silt.

dnd5e's `vehicleTypes` table does double duty, so one key gets both: **Silt**
appears in the vehicle sheet's type dropdown, and **Vehicles (Silt)** becomes a
proficiency a character can hold, referenced as `tool:vehicle:silt`.

The vehicle sheet paints its background from `--underlay-vehicle-<type>`, and
dnd5e only ships artwork for land, water, air and space. The module supplies the
missing variable, aliased to the water artwork — a skimmer is a ship, whatever
it sails on.

## Installation

Paste this manifest URL into Foundry's *Install Module* dialog:

```
https://github.com/ctbritt/foundry-dark-sun-essentials/releases/latest/download/module.json
```

Then enable the module. The toggles are in **Configure Settings → Module
Settings**, under Dark Sun Essentials.

### Or: the world-script edition

If this is only ever going into one world, `world-script/dark-sun-essentials.js`
is the same five features in a single file with flags at the top — no manifest,
no installed package, no assets. Drop it in `worlds/<your-world>/scripts/` and
list it under `"scripts"` in `world.json`. See
[`world-script/README.md`](world-script/README.md) for what you give up.

## Notes

**Settings require a reload.** dnd5e builds its data model from configuration
the first time a document is touched in a session, so a currency added
mid-session would exist in the config table but not in any actor's schema.
Foundry will prompt for the reload.

**Back up before removing the standard coins.** The conversion is exact and
tested, but it rewrites actor data, and no in-Foundry undo exists.

**To convert balances without removing the old coins**, run this from a macro:

```js
game.modules.get("dark-sun-essentials").api.openMigrationDialog();
```

It scans first and shows you the counts before writing anything. You do not need
this to remove the standard coins — that toggle offers the migration itself.

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
application, the migration, and the migration dialog. The split exists so the
part that can lose a player's money is testable, and so a future system change
is confined to the adapter.

The design document is in `docs/superpowers/specs/`.

### Releasing

Two workflows, both in `.github/workflows/`:

- **CI** runs the suite on every push and pull request.
- **Release** fires when a GitHub Release is *published*.

To cut a release: bump `version` in both `module.json` and `package.json`, add a
`## <version>` heading to `CHANGELOG.md`, commit, then publish a GitHub Release
tagged `v<version>`. The workflow re-runs the tests, refuses to continue if the
tag and manifest disagree, rewrites `manifest`/`download` to point at that
release, zips only the runtime files, and attaches `module.json` and
`module.zip` to the release.

Version drift, a missing changelog entry, a manifest pointing at a file that no
longer exists, and a `v` prefix leaking into `version` are all caught by
`test/manifest.test.mjs`, so they fail locally rather than after publication.

The final step publishes to the Foundry package registry via
[`cs96and/FoundryVTT-release-package`](https://github.com/cs96and/FoundryVTT-release-package).
It is **skipped** unless a `PACKAGE_TOKEN` repository secret exists — that token
comes from the package's own page on foundryvtt.com, which requires registering
the package there first. Until then, releases still work and the manifest URL
above still installs; registration buys discoverability in Foundry's browser,
not function.

## Licence

MIT.
