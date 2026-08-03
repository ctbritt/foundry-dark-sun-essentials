/**
 * Settings registration.
 *
 * Every toggle is world-scoped, GM-only, and requires a reload. That is not
 * caution for its own sake: dnd5e builds its data model schemas from CONFIG the
 * first time a document is accessed, so a currency added mid-session would
 * exist in the config table but not in any actor's schema.
 */

import { MODULE_ID, SETTINGS } from "./core/constants.mjs";
import { log } from "./compat.mjs";
import DarkSunSettingsMenu from "./apps/settings-menu.mjs";
import { confirmLegacyRemoval } from "./apps/migration-dialog.mjs";

/** Read a module setting, falling back to `false` before registration completes. */
export function setting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return false;
  }
}

/**
 * Register the settings menu and every toggle.
 * Called from `init`, before config is applied.
 */
export function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "config", {
    name: `${MODULE_ID}.menu.name`,
    label: `${MODULE_ID}.menu.label`,
    hint: `${MODULE_ID}.menu.hint`,
    icon: "fa-solid fa-sun-dust",
    type: DarkSunSettingsMenu,
    restricted: true
  });

  game.settings.register(MODULE_ID, SETTINGS.ceramicCurrency, {
    name: `${MODULE_ID}.settings.ceramicCurrency.name`,
    hint: `${MODULE_ID}.settings.ceramicCurrency.hint`,
    scope: "world",
    config: true,
    requiresReload: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.removeLegacyCurrency, {
    name: `${MODULE_ID}.settings.removeLegacyCurrency.name`,
    hint: `${MODULE_ID}.settings.removeLegacyCurrency.hint`,
    scope: "world",
    config: true,
    requiresReload: true,
    type: Boolean,
    default: false,
    onChange: onRemoveLegacyChanged
  });

  game.settings.register(MODULE_ID, SETTINGS.psionicSchool, {
    name: `${MODULE_ID}.settings.psionicSchool.name`,
    hint: `${MODULE_ID}.settings.psionicSchool.hint`,
    scope: "world",
    config: true,
    requiresReload: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.materialProperties, {
    name: `${MODULE_ID}.settings.materialProperties.name`,
    hint: `${MODULE_ID}.settings.materialProperties.hint`,
    scope: "world",
    config: true,
    requiresReload: true,
    type: Boolean,
    default: false
  });

  log("debug", "Settings registered.");
}

/* -------------------------------------------- */

/**
 * Guard the destructive path.
 *
 * Removing the standard coins drops them from the actor schema, so any balance
 * still held in them becomes unreadable. The GM is shown exactly what will
 * happen and offered the migration before the setting is allowed to stand.
 *
 * @param {boolean} enabled  The new setting value.
 */
async function onRemoveLegacyChanged(enabled) {
  if ( !enabled || !game.user?.isGM ) return;

  // Removal is meaningless without a replacement, and `buildCurrencyConfig`
  // refuses it anyway. Say so rather than letting the toggle look effective.
  if ( !setting(SETTINGS.ceramicCurrency) ) {
    ui.notifications?.warn(game.i18n.localize(`${MODULE_ID}.notify.removalNeedsCeramic`));
    return;
  }

  await confirmLegacyRemoval();
}
