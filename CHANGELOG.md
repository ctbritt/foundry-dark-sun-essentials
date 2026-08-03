# Changelog

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
