# Changelog

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
