/**
 * Version detection and the handful of API shims v13 and v14 need.
 *
 * The philosophy here is that a missing extension point should be reported by
 * name and then skipped, never written to on faith. dnd5e 6.0 is unreleased at
 * time of writing and is documented as an ambitious release; when it lands,
 * this file is where it should break, loudly and legibly.
 */

import { MODULE_ID, REQUIRED_CONFIG_PATHS } from "./core/constants.mjs";

/** @returns {number} The Foundry generation, e.g. 13 or 14. */
export function foundryGeneration() {
  const parsed = Number.parseInt(game.release?.generation ?? game.version, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** @returns {string} The installed dnd5e version, or "" if it cannot be read. */
export function systemVersion() {
  return game.system?.version ?? "";
}

/** @returns {number} The dnd5e major version, e.g. 5 or 6. */
export function systemMajorVersion() {
  const parsed = Number.parseInt(systemVersion(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* -------------------------------------------- */
/*  Namespace shims                              */
/* -------------------------------------------- */

/**
 * Handlebars helpers moved to `foundry.applications.handlebars` in v13 and the
 * bare globals were removed in v14. Prefer the namespaced form, fall back for
 * safety, and no-op rather than throw if neither exists.
 * @param {string[]} paths  Template paths to preload.
 * @returns {Promise<void>}
 */
export async function loadTemplatesCompat(paths) {
  const loader = foundry?.applications?.handlebars?.loadTemplates
    ?? globalThis.loadTemplates;
  if ( typeof loader !== "function" ) {
    log("warn", "No template loader available; templates will load on demand.");
    return;
  }
  await loader(paths);
}

/* -------------------------------------------- */
/*  Extension point verification                 */
/* -------------------------------------------- */

/**
 * Confirm the config the module intends to write to actually exists and has
 * the shape we expect.
 *
 * @returns {{ok: boolean, missing: string[], malformed: string[]}}
 */
export function verifyExtensionPoints() {
  const dnd5e = CONFIG.DND5E;
  const missing = [];
  const malformed = [];

  if ( !dnd5e ) return { ok: false, missing: ["CONFIG.DND5E"], malformed };

  for ( const path of Object.values(REQUIRED_CONFIG_PATHS) ) {
    if ( !(path in dnd5e) ) missing.push(`CONFIG.DND5E.${path}`);
  }

  // `defaultCurrency` is a string; the rest are objects. `validProperties`
  // values must be Sets, because the system spreads them into a new Set.
  if ( ("defaultCurrency" in dnd5e) && (typeof dnd5e.defaultCurrency !== "string") ) {
    malformed.push("CONFIG.DND5E.defaultCurrency is not a string");
  }
  for ( const path of ["currencies", "spellSchools", "itemProperties", "validProperties", "vehicleTypes"] ) {
    if ( (path in dnd5e) && (typeof dnd5e[path] !== "object") ) {
      malformed.push(`CONFIG.DND5E.${path} is not an object`);
    }
  }
  if ( dnd5e.validProperties?.weapon && !(dnd5e.validProperties.weapon instanceof Set) ) {
    malformed.push("CONFIG.DND5E.validProperties.weapon is not a Set");
  }

  return { ok: !missing.length && !malformed.length, missing, malformed };
}

/**
 * Warn the GM once that the system has moved out from under the module.
 * Errs toward doing nothing rather than corrupting data.
 * @param {{missing: string[], malformed: string[]}} result
 */
export function reportIncompatibility({ missing, malformed }) {
  const detail = [...missing.map(m => `missing ${m}`), ...malformed].join("; ");
  log("error", `dnd5e ${systemVersion()} does not expose the configuration this module needs: ${detail}`);
  if ( game.user?.isGM ) {
    ui.notifications?.error(game.i18n.format(`${MODULE_ID}.notify.incompatible`, {
      system: systemVersion()
    }), { permanent: true });
  }
}

/* -------------------------------------------- */
/*  Logging                                      */
/* -------------------------------------------- */

/**
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {...any} args
 */
export function log(level, ...args) {
  const method = console[level] ?? console.log;
  method.call(console, `${MODULE_ID} |`, ...args);
}
