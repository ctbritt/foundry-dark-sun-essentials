/**
 * Dark Sun Essentials — entry point.
 *
 * Everything happens in `init`, and in this order: register settings, then read
 * them, then mutate CONFIG.DND5E. It has to be `init` because dnd5e builds its
 * data model schemas from CONFIG the first time a document is touched, which
 * happens after `init` completes and only once per session.
 */

import { MODULE_ID } from "./core/constants.mjs";
import { foundryGeneration, log, systemVersion } from "./compat.mjs";
import { registerSettings } from "./settings.mjs";
import { applyConfig } from "./config-apply.mjs";
import { applyMigration, runMigration, scanWorld, summarise } from "./migration.mjs";
import { openMigrationDialog } from "./apps/migration-dialog.mjs";

Hooks.once("init", () => {
  log("info", `Initialising for Foundry v${foundryGeneration()}, dnd5e ${systemVersion()}.`);

  registerSettings();
  applyConfig();

  // A small public surface, so macros and other modules can drive the
  // migration without reaching into internals. `openMigrationDialog()` is how
  // a GM converts balances without removing the standard coins:
  //   game.modules.get("dark-sun-essentials").api.openMigrationDialog()
  const module = game.modules.get(MODULE_ID);
  if ( module ) module.api = { scanWorld, summarise, applyMigration, runMigration, openMigrationDialog };
});

Hooks.once("ready", () => {
  if ( !game.user?.isGM ) return;

  // dnd5e 6.0 is unreleased at time of writing and is documented as a large
  // change. Say so once rather than letting a silent failure look like a bug.
  const major = Number.parseInt(systemVersion(), 10);
  if ( major > 5 ) {
    log("warn", `dnd5e ${systemVersion()} is newer than this module was tested against (5.3.x).`);
    ui.notifications?.warn(game.i18n.format(`${MODULE_ID}.notify.untestedSystem`, {
      system: systemVersion()
    }));
  }
});
