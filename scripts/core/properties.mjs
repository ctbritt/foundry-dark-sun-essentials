/**
 * Shared merge semantics for `CONFIG.DND5E.itemProperties` and
 * `.validProperties`.
 *
 * Two features write to these tables — materials and psionics — and they have
 * to compose: enabling both must leave a weapon able to carry `obsidian` and
 * `psi` at once. Every function here returns a new table and leaves its input
 * alone, so the calls can be chained in any order and a disabled feature is
 * simply a call that never happens.
 */

/**
 * Merge property definitions into the system's property table.
 * @param {object} existing   The current `CONFIG.DND5E.itemProperties`.
 * @param {object} additions  Definitions to add, keyed by property key.
 * @returns {object}          A new table. The input is not mutated.
 */
export function mergeItemProperties(existing, additions) {
  return { ...existing, ...additions };
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
    next[type] = new Set([ ...(existing?.[type] ?? []), ...keys ]);
  }
  return next;
}
