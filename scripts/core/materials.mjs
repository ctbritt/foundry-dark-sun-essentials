/**
 * Material properties for weapons and armour.
 *
 * On Athas metal is scarce enough to be a plot point, so what a blade is made
 * of is worth recording on the item itself. These are tags: they render, they
 * filter, they are readable by macros and other modules. They carry no combat
 * automation — see the design doc for why.
 */

import { MATERIAL_ITEM_TYPES, MODULE_ID } from "./constants.mjs";
import { mergeItemProperties, mergeValidProperties } from "./properties.mjs";

/**
 * Shape matches dnd5e's ItemPropertyConfiguration typedef.
 * `isPhysical` marks a property as one that can bypass damage resistance,
 * which is how the system groups adamantine and silvered. Athasian materials
 * are descriptive, not resistance-piercing, so it is deliberately unset.
 * @type {Record<string, {label: string}>}
 */
export const MATERIAL_PROPERTIES = Object.freeze({
  wood: Object.freeze({ label: `${MODULE_ID}.material.wood` }),
  bone: Object.freeze({ label: `${MODULE_ID}.material.bone` }),
  stone: Object.freeze({ label: `${MODULE_ID}.material.stone` }),
  obsidian: Object.freeze({ label: `${MODULE_ID}.material.obsidian` }),
  metal: Object.freeze({ label: `${MODULE_ID}.material.metal` })
});

/** @type {string[]} */
export const MATERIAL_KEYS = Object.freeze(Object.keys(MATERIAL_PROPERTIES));

/**
 * Merge the material properties into the system's property table.
 * @param {object} existing  The current `CONFIG.DND5E.itemProperties`.
 * @returns {object}         A new table. The input is not mutated.
 */
export function buildItemProperties(existing) {
  return mergeItemProperties(existing, MATERIAL_PROPERTIES);
}

/**
 * Register the materials as valid on weapons and armour.
 *
 * dnd5e models armour as the `equipment` item type.
 *
 * @param {Record<string, Set<string>>} existing  The current `CONFIG.DND5E.validProperties`.
 * @param {string[]} [types]                      Item types to extend.
 * @returns {Record<string, Set<string>>}         A new table. The input is not mutated.
 */
export function buildValidProperties(existing, types = MATERIAL_ITEM_TYPES) {
  return mergeValidProperties(existing, MATERIAL_KEYS, types);
}
