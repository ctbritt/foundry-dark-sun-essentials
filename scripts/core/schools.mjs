/**
 * The Psionic spell school.
 *
 * Athasian psionics are not arcane magic, but modelling them as a spell school
 * means every existing tool — spell lists, filters, the compendium browser,
 * `@Spell` enrichers — works on them without further code.
 */

import { MODULE_ID } from "./constants.mjs";

/** The key added to `CONFIG.DND5E.spellSchools`. */
export const PSIONIC_KEY = "psi";

/**
 * Shape matches dnd5e's SpellSchoolConfiguration typedef.
 * `fullKey` is what enrichers accept as an alternate spelling, so
 * `psionic` resolves as well as `psi`. `reference` is omitted deliberately:
 * there is no SRD rules page to point at.
 * @type {{label: string, icon: string, fullKey: string}}
 */
export const PSIONIC_SCHOOL = Object.freeze({
  label: `${MODULE_ID}.school.psionic`,
  icon: `modules/${MODULE_ID}/icons/psionic.svg`,
  fullKey: "psionic"
});

/**
 * Merge the Psionic school into the system's school table.
 * @param {object} existing  The current `CONFIG.DND5E.spellSchools`.
 * @returns {object}         A new table. The input is not mutated.
 */
export function buildSpellSchools(existing) {
  return { ...existing, [PSIONIC_KEY]: PSIONIC_SCHOOL };
}
