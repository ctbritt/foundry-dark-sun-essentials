/**
 * Shared identifiers. No Foundry globals — safe to import from tests.
 */

export const MODULE_ID = "dark-sun-essentials";

/** Setting keys, world-scoped and GM-only. */
export const SETTINGS = {
  ceramicCurrency: "ceramicCurrency",
  removeLegacyCurrency: "removeLegacyCurrency",
  psionicSchool: "psionicSchool",
  materialProperties: "materialProperties",
  siltVehicles: "siltVehicles"
};

/** Currency keys this module adds. */
export const CERAMIC_KEYS = ["ct", "cb", "lb"];

/** Currency keys dnd5e ships with, which the removal toggle strips. */
export const LEGACY_KEYS = ["pp", "gp", "ep", "sp", "cp"];

/** Item types that gain material properties. dnd5e models armor as `equipment`. */
export const MATERIAL_ITEM_TYPES = ["weapon", "equipment"];

/**
 * CONFIG.DND5E paths the module writes to. Verified at init so a future
 * system release that moves one of them fails loudly instead of silently.
 */
export const REQUIRED_CONFIG_PATHS = {
  currencies: "currencies",
  defaultCurrency: "defaultCurrency",
  spellSchools: "spellSchools",
  itemProperties: "itemProperties",
  validProperties: "validProperties",
  vehicleTypes: "vehicleTypes"
};
