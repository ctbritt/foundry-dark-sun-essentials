/**
 * Helpers for writing into the `CONFIG.DND5E` tables.
 *
 * Every function here returns a new table and leaves its input alone, so the
 * calls compose in any order and a disabled feature is simply a call that never
 * happens. Enabling both materials and psionics, for instance, must leave a
 * weapon able to carry `obsidian` and `psi` at once.
 */

/**
 * Return a mutable deep copy of a definition.
 *
 * This is not defensive habit — it is required. dnd5e localizes its config
 * tables at `i18nInit` by writing the translated strings *back into the objects
 * in place* (`_localizeObject` → `foundry.utils.setProperty(v, key, ...)`).
 * Handing it one of this module's frozen definitions throws a TypeError in
 * strict mode, and because dnd5e localizes every registered table in a single
 * loop, that throw takes down localization for every table registered after
 * ours — including the system's own. The symptom is raw i18n keys in the UI, in
 * places that have nothing to do with this module.
 *
 * The definitions stay frozen where they are declared, so the pure core cannot
 * be mutated by accident. Only the copy handed to Foundry is writable.
 *
 * @template T
 * @param {T} definition  A plain, JSON-shaped definition, or a table of them.
 * @returns {T}           A writable deep copy.
 */
export function thaw(definition) {
  return structuredClone(definition);
}

/**
 * Merge property definitions into the system's property table.
 * @param {object} existing   The current `CONFIG.DND5E.itemProperties`.
 * @param {object} additions  Definitions to add, keyed by property key.
 * @returns {object}          A new table. The input is not mutated.
 */
export function mergeItemProperties(existing, additions) {
  return { ...existing, ...thaw(additions) };
}

/**
 * Register property keys as valid on the given item types.
 *
 * `validProperties` values are Sets which the system reads through a runtime
 * getter, so fresh Sets rather than in-place mutation keeps this re-runnable
 * and keeps the system's own Sets untouched. An item type the system has not
 * defined is created rather than skipped.
 *
 * @param {Record<string, Set<string>>} existing  The current `CONFIG.DND5E.validProperties`.
 * @param {string[]} keys                         Property keys to register.
 * @param {string[]} types                        Item types to extend.
 * @returns {Record<string, Set<string>>}         A new table. The input is not mutated.
 */
export function mergeValidProperties(existing, keys, types) {
  const next = { ...existing };
  for ( const type of types ) {
    const current = existing?.[type];
    const merged = new Set([ ...(current ?? []), ...keys ]);
    copySubtypeSets(current, merged);
    next[type] = merged;
  }
  return next;
}

/**
 * Carry subtype-specific property sets across to a rebuilt Set.
 *
 * dnd5e 6.0 hangs extra Sets off the per-type Set as plain properties, keyed by
 * item subtype — `validProperties.consumable.ammo` is a Set holding `ret`, so
 * only ammunition offers the Returning property. A fresh `new Set([...])` has
 * no such properties, and the system reads them straight off the Set object,
 * so rebuilding without copying silently removed Returning from every arrow
 * in the world. The sub-Sets are copied rather than shared so the system's own
 * objects stay untouched, matching the rest of this file.
 *
 * @param {Set<string>|undefined} from  The system's Set, possibly carrying subtype Sets.
 * @param {Set<string>} to              The rebuilt Set to decorate.
 */
function copySubtypeSets(from, to) {
  if ( !(from instanceof Set) ) return;
  for ( const [subtype, subset] of Object.entries(from) ) {
    to[subtype] = subset instanceof Set ? new Set(subset) : subset;
  }
}
