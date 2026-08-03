/**
 * Silt as a vehicle type.
 *
 * The Sea of Silt is sailed, not crossed, and a skimmer is neither a boat nor a
 * wagon. dnd5e's `vehicleTypes` table does double duty: it fills the vehicle
 * sheet's type dropdown (`system.details.type`) and it registers the matching
 * vehicle proficiency, so adding one key gets both `silt` on the sheet and
 * `tool:vehicle:silt` on the character.
 *
 * Values in this table are bare strings, not objects — dnd5e pre-localizes it
 * with no `keys` option, so anything else logs a console error at `i18nInit`.
 */

import { MODULE_ID } from "./constants.mjs";

/** The key added to `CONFIG.DND5E.vehicleTypes`. */
export const SILT_KEY = "silt";

/** @type {string} */
export const SILT_VEHICLE = `${MODULE_ID}.vehicle.silt`;

/**
 * The stock type whose sheet artwork silt borrows.
 *
 * The vehicle sheet paints its background from `--underlay-vehicle-<type>`, and
 * dnd5e only defines land/water/air/space. Without this, a silt vehicle renders
 * with no artwork at all. The alias lives in the stylesheet; the constant is
 * here so the two cannot drift apart unnoticed.
 */
export const SILT_UNDERLAY_SOURCE = "water";

/**
 * Merge silt into the system's vehicle table.
 * @param {Record<string, string>} existing  The current `CONFIG.DND5E.vehicleTypes`.
 * @returns {Record<string, string>}         A new table. The input is not mutated.
 */
export function buildVehicleTypes(existing) {
  return { ...existing, [SILT_KEY]: SILT_VEHICLE };
}
