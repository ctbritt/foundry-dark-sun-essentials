# Changelog

## 1.6.1 — 2026-09-04

### Fixed
- **dnd5e 6.0 compatibility.** Verified against dnd5e 6.0.0 on Foundry 14.367;
  every feature applies and the "untested system" warning no longer fires for
  6.x. One real regression was found and fixed: dnd5e 6.0 hangs subtype-only
  property sets off the per-type `validProperties` Sets (for example
  `validProperties.consumable.ammo` holds `ret`, so only ammunition offers the
  Returning property). `mergeValidProperties` rebuilt those Sets from scratch
  and dropped the sub-Sets, which silently removed Returning from every
  ammunition item once the Psionic property was enabled. The sub-Sets are now
  carried across.

## 1.6.0 — 2026-08-14

### Added
- **Survival tracking.** A toggle that adds a macro resolving a day of desert
  travel — water requirements, dehydration and exhaustion — for the whole
  party, pack beasts included. Run it from **Resolve Survival Day** in the
  Dark Sun Essentials: Macros compendium. The dialog collects pace, heat,
  shelter and each member's intake; the arithmetic lives in
  `scripts/core/survival.mjs`, pure and fully covered by `npm test`. The
  result posts as a GM-only chat card and nothing is written to a sheet until
  the GM presses Apply. Food, foraging, forced march, navigation and weather
  ship as journal text in Dark Sun Journals rather than automation.

  Apply writes exhaustion and nothing else. Water items are not decremented —
  the gallons on the card are what the party is carrying now, not a running
  total — and a card can be applied only once.

## 1.5.0 — 2026-08-11

### Added
- **The eleventh pack: Dark Sun Journals, moved here from `shareddata`.** It
  stayed behind in 1.4.0 because 78% of it was base64 image data and doubling
  the module's git history for that felt premature. It's here now anyway — the
  module was the point of the move, and a Dark Sun module without its lore
  journals was the odd one out.

  Same rules as 1.4.0: pack name and every document ID unchanged, only the
  module segment of a compendium address moves. The 44 references inside the
  journals themselves — to equipment, the creature catalog, spells, and to
  other journal pages — were rewritten to match.
  `tools/repoint-moved-packs.mjs` now includes `dark-sun-journals` in what it
  repoints; existing worlds need re-running it.

  Left alone: two references to `shareddata.ddb-races`, inside the journals.
  That pack doesn't exist anymore — it was renamed to `ddb-species` when the
  installation moved to 2024 terminology — so those two links were already
  broken before this move, and fixing them isn't a packaging change.

## 1.4.0 — 2026-08-11

### Added
- **Ten compendium packs, moved here from `shareddata`.** Character origins,
  classes, the creature catalog, equipment, feats, harvest items, items,
  rolltables, scenes and spells. They were always Dark Sun content sitting in a
  general-purpose sharing module; this puts them with the rules that make them
  work.

  Pack names are unchanged, and so are every document's ID, so the only part of
  a compendium address that moves is the module: `shareddata.dark-sun-spells`
  becomes `dark-sun-essentials.dark-sun-spells`. The 4,140 cross-references
  inside the moved packs were rewritten to match. References to packs that
  stayed behind — `dark-sun-journals` and every `ddb-*` — were left alone.

  **Existing worlds need migrating.** Anything that pointed at these packs by
  their old address still does. See `tools/repoint-moved-packs.mjs`.

### Fixed
- **Fourteen duplicate embedded effects in the creature catalog.** Ten actors
  carried `guidance10000000` and `resistance100000` twice on the same item —
  the padding in whatever generated those IDs collided index 1 with index 10.
  LevelDB kept one of each pair and the duplicates were invisible in play, but
  they made the pack impossible to rebuild from source. The copies were
  byte-identical, so removing them changes nothing a player would see.

  Worth knowing: the effect that *should* have held the second ID was
  overwritten before this module ever saw the data, so a Guidance and a
  Resistance option are simply missing from those ten stat blocks. Restoring
  them means deciding what they were, which is a content question, not a
  packaging one.

## 1.3.0 — 2026-08-06

### Added
- A **Convert to Athasian Coinage** macro, shipped in the module's compendium.
  v1.2.0 removed the settings window that held this button, leaving the
  conversion reachable only by arming the removal toggle.
- The conversion now offers unlocked compendium packs. Actor packs get their
  currency converted, item packs get their prices. Every pack is a separate
  checkbox and none are ticked by default.

### Changed
- The migration dialog warns about backups whenever packs are on offer, not
  only when the standard coins are being removed.

## 1.2.0 — 2026-08-04

Adds a Psionic item property, and removes the configuration window in favour of
the toggles Foundry already shows.

- **Psionic is now an item property as well as a spell school.** The school
  answers what kind of magic a power is, which only spells have. The property
  answers whether a thing is psionic at all — a question a wild talent, a
  mind-forged blade, a psionic focus and a brewed draught all raise. It is
  valid on `spell`, `weapon`, `equipment`, `consumable` and `feat`, and it is a
  descriptive tag: no automation, and no `isPhysical`, so it does not claim to
  bypass damage resistance. Toggled separately from the school.
- **The "Configure Athas" window is gone.** The toggles live directly in the
  module's section of Foundry's settings list, where they already appeared.
  Five checkboxes did not need a second home, and two places holding the same
  state is two places for it to drift.
- **Converting balances without removing the old coins is now an API call.**
  That button lived in the window. Run
  `game.modules.get("dark-sun-essentials").api.openMigrationDialog()` from a
  macro. The path that actually matters is unchanged: enabling *Remove Standard
  Coinage* still scans the world and offers the migration before anything is
  written.
- **The Lead Bead is now abbreviated `bd`, not `lb`.** `lb` is also dnd5e's
  abbreviation for the pound, and a character sheet prints coin and carried
  weight inches apart, so `0 lb` sat beside `10 lb` meaning two unrelated
  things. Only the display form changed — the currency is still keyed `lb`,
  which is what actor balances and item prices are stored under, so no existing
  data moves and no migration is needed.

- **Fixed: coin and property names showed as raw i18n keys.** Present since
  1.0.0, and visible as `DARK-SUN-ESSENTIALS.CURRENCY.CT.ABBR` where `ct` should
  be. dnd5e translates its configuration by writing the translated text back
  into the config objects in place; this module handed it frozen objects, so
  the write threw. Because dnd5e does every table in one pass, the failure also
  took out tables belonging to the system itself — `DND5E.UNITS.WEIGHT.Pound.
  Abbreviation` appearing literally in a Tidy 5e weight column was this bug, not
  a Tidy bug. Definitions are now copied on their way into the config.

- **Fixed: arming removal without ceramic coinage no longer leaves it armed.**
  Ticking *Remove Standard Coinage* without *Athasian Coinage* warned and then
  did nothing, but the setting stayed on. Enabling ceramic coinage later would
  have stripped the standard coins on the next reload without ever offering the
  migration. The setting is now switched back off.

## 1.1.1 — 2026-08-03

No change to how the module behaves in a world. This hardens the release
workflow against the way 1.1.0 was nearly published broken.

- **A failed release no longer leaves a broken one published.** The workflow is
  triggered by `release: published`, so the release is already public before any
  check has run. If a check now fails before the assets are attached, the
  release is converted back to a draft — it stops being "Latest", and the
  install URL in the README stops returning 404. Failures after the assets land,
  such as the optional package-registry step, leave the good release alone.
- **Malformed tags are caught by shape, not just by mismatch.** `v1.10` is not a
  typo for `v1.1.0`; it is one-point-ten, and both Foundry and GitHub compare
  versions numerically. The workflow now rejects any tag that is not three
  numeric parts, and says so in those words.

## 1.1.0 — 2026-08-03

- **Silt vehicles.** Adds Silt to `CONFIG.DND5E.vehicleTypes`, which puts it in
  the vehicle sheet's type list and registers `tool:vehicle:silt` as a vehicle
  proficiency. Ships the `--underlay-vehicle-silt` sheet background dnd5e does
  not define, aliased to the water artwork.
- **World-script edition.** `world-script/dark-sun-essentials.js` is the whole
  module in one file, for GMs who only want this in a single world. Feature
  flags at the top instead of a settings window; the currency migration runs
  from a macro via `game.darkSun.convertCurrency()`, dry-run by default.
  It mutates the config tables in place rather than replacing them, which is
  correct regardless of when dnd5e builds its data model schemas.
- `vehicleTypes` joins the startup verification, so a system that moves it
  disables features rather than writing to a table that is not there.
- CI and release workflows. Publishing a GitHub Release now runs the suite,
  checks the tag against the manifest, pins the manifest and download URLs to
  that release, packages the runtime files, and attaches both to the release.
  Foundry package-registry publication runs too, once a `PACKAGE_TOKEN` secret
  exists.
- The manifest URL now tracks `releases/latest` rather than the `main` branch,
  so Foundry never offers a version whose release assets do not exist yet.

## 1.0.0 — 2026-08-03

First release.

- Athasian coinage: Ceramic Token, Ceramic Bit and Lead Bead as real currency
  fields, at parity with gold, silver and copper.
- Optional removal of platinum, gold, electrum, silver and copper, gated behind
  an exact, idempotent migration covering world actors, carried items, sidebar
  items and unlinked tokens.
- Psionic spell school.
- Wood, Bone, Stone, Obsidian and Metal properties on weapons and armour.
- ApplicationV2 settings window and DialogV2 migration confirmation.
- Startup verification of every dnd5e configuration point the module writes to,
  so an unrecognised system version disables features rather than corrupting data.
