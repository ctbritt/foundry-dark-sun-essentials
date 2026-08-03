/**
 * Applies the enabled settings to CONFIG.DND5E.
 *
 * Runs once, during `init`. Each feature is verified and applied independently
 * so a system change that breaks one does not take the others down with it.
 */

import { SETTINGS } from "./core/constants.mjs";
import { buildCurrencyConfig } from "./core/coinage.mjs";
import { buildItemProperties, buildValidProperties } from "./core/materials.mjs";
import { buildSpellSchools } from "./core/schools.mjs";
import { log, reportIncompatibility, verifyExtensionPoints } from "./compat.mjs";
import { setting } from "./settings.mjs";

/**
 * Mutate CONFIG.DND5E according to the world's settings.
 * @returns {{applied: string[], skipped: string[]}}  What changed, for the log.
 */
export function applyConfig() {
  const check = verifyExtensionPoints();
  if ( !check.ok ) {
    reportIncompatibility(check);
    return { applied: [], skipped: ["all"] };
  }

  const applied = [];
  const skipped = [];

  const ceramic = setting(SETTINGS.ceramicCurrency);
  const removeLegacy = setting(SETTINGS.removeLegacyCurrency);

  if ( ceramic ) {
    const { currencies, defaultCurrency } = buildCurrencyConfig(CONFIG.DND5E.currencies, {
      ceramic, removeLegacy
    });
    CONFIG.DND5E.currencies = currencies;
    if ( defaultCurrency ) CONFIG.DND5E.defaultCurrency = defaultCurrency;
    applied.push(removeLegacy ? "ceramic currency (legacy removed)" : "ceramic currency");
  } else {
    skipped.push("ceramic currency");
    if ( removeLegacy ) {
      // Refuse silently-destructive half-states: without ceramic coin there is
      // nothing to remove the standard coins in favour of.
      log("warn", "Legacy currency removal is enabled but ceramic currency is not. Ignoring removal.");
    }
  }

  if ( setting(SETTINGS.psionicSchool) ) {
    CONFIG.DND5E.spellSchools = buildSpellSchools(CONFIG.DND5E.spellSchools);
    applied.push("psionic school");
  } else skipped.push("psionic school");

  if ( setting(SETTINGS.materialProperties) ) {
    CONFIG.DND5E.itemProperties = buildItemProperties(CONFIG.DND5E.itemProperties);
    CONFIG.DND5E.validProperties = buildValidProperties(CONFIG.DND5E.validProperties);
    applied.push("material properties");
  } else skipped.push("material properties");

  log("info", applied.length ? `Applied: ${applied.join(", ")}.` : "No features enabled.");
  return { applied, skipped };
}
