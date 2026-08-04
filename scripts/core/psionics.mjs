/**
 * Psionics: the spell school, and the item property.
 *
 * These answer different questions and are toggled separately. The school
 * answers "what kind of magic is this power" — a question only spells have.
 * The property answers "is this thing psionic at all", which on Athas gets
 * asked about a wild-talent feature, a mind-forged blade and a psionically
 * brewed draught as often as about a power.
 *
 * Athasian psionics are not arcane magic, but modelling powers as a spell
 * school means every existing tool — spell lists, filters, the compendium
 * browser, `@Spell` enrichers — works on them without further code.
 */

import { MODULE_ID, PSIONIC_ITEM_TYPES } from "./constants.mjs";
import { mergeItemProperties, mergeValidProperties, thaw } from "./config-tables.mjs";

/**
 * The key used in both `CONFIG.DND5E.spellSchools` and
 * `CONFIG.DND5E.itemProperties`. Sharing it is safe — they are separate tables
 * — and it keeps one spelling of "psionic" in stored data. dnd5e's own property
 * keys are short in the same way (`mgc`, `ada`, `fin`), and the key never faces
 * the user: the label does.
 */
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
 * Shape matches dnd5e's ItemPropertyConfiguration typedef.
 *
 * `isPhysical` is deliberately unset: that flag means "can bypass damage
 * resistance", which is how the system groups adamantine and silvered. Psionic
 * origin is descriptive here, the same posture the materials take — the module
 * tags things, it does not adjudicate them.
 * @type {{label: string, icon: string}}
 */
export const PSIONIC_PROPERTY = Object.freeze({
  label: `${MODULE_ID}.property.psionic`,
  icon: `modules/${MODULE_ID}/icons/psionic.svg`
});

/* -------------------------------------------- */

/**
 * Merge the Psionic school into the system's school table.
 * @param {object} existing  The current `CONFIG.DND5E.spellSchools`.
 * @returns {object}         A new table. The input is not mutated.
 */
export function buildSpellSchools(existing) {
  return { ...existing, [PSIONIC_KEY]: thaw(PSIONIC_SCHOOL) };
}

/**
 * Merge the Psionic property into the system's property table.
 * @param {object} existing  The current `CONFIG.DND5E.itemProperties`.
 * @returns {object}         A new table. The input is not mutated.
 */
export function buildPsionicProperty(existing) {
  return mergeItemProperties(existing, { [PSIONIC_KEY]: PSIONIC_PROPERTY });
}

/**
 * Register the Psionic property as valid on the item types that can be psionic.
 * @param {Record<string, Set<string>>} existing  The current `CONFIG.DND5E.validProperties`.
 * @param {string[]} [types]                      Item types to extend.
 * @returns {Record<string, Set<string>>}         A new table. The input is not mutated.
 */
export function buildPsionicValidProperties(existing, types = PSIONIC_ITEM_TYPES) {
  return mergeValidProperties(existing, [PSIONIC_KEY], types);
}
