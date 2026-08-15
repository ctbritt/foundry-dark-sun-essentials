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
import { isSurvivalApplied, onApplySurvival, openSurvivalDialog } from "./apps/survival-dialog.mjs";

Hooks.once("init", () => {
  log("info", `Initialising for Foundry v${foundryGeneration()}, dnd5e ${systemVersion()}.`);

  registerSettings();
  applyConfig();

  // A small public surface, so macros and other modules can drive the
  // migration without reaching into internals. `openMigrationDialog()` is how
  // a GM converts balances without removing the standard coins:
  //   game.modules.get("dark-sun-essentials").api.openMigrationDialog()
  const module = game.modules.get(MODULE_ID);
  if ( module ) module.api = {
    scanWorld, summarise, applyMigration, runMigration, openMigrationDialog,
    openSurvivalDialog
  };
});

Hooks.once("ready", () => {
  // v13 renamed the hook and changed the payload from jQuery to a bare
  // element. Both are bound so one build works on v13 and v14; which one
  // actually fires is a question only a real load can answer — and if both
  // fire, this runs twice for the same button.
  const bindCard = (message, element) => {
    const html = element instanceof HTMLElement ? element : element?.[0];
    const button = html?.querySelector?.('[data-action="dse-apply-survival"]');
    if ( !button ) return;

    // A spent card is re-rendered from stored HTML that knows nothing about
    // having been pressed, so the button comes back live. Show it as spent and
    // leave it unbound.
    if ( isSurvivalApplied(message) ) {
      button.disabled = true;
      return;
    }

    // One listener per button, whatever the hooks do. Two listeners means one
    // click runs two applies concurrently against the same actor.update()
    // calls, and the rows race.
    if ( button.dataset.dseBound ) return;
    button.dataset.dseBound = "1";
    button.addEventListener("click", () => onApplySurvival(message, button));
  };
  Hooks.on("renderChatMessageHTML", bindCard);
  Hooks.on("renderChatMessage", bindCard);

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
