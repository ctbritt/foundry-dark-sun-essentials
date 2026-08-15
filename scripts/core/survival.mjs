/**
 * Athasian survival: water requirements, dehydration, and rest.
 *
 * No Foundry globals. Every function here is pure so the arithmetic can be
 * tested without booting a world — this is the part of the module that can
 * kill a player's character if it is wrong.
 *
 * The rules are Athas 5e slice 1 (`01-survival.md`), adjudicated against the
 * 2024 Player's Handbook. Constants below are hand-copied from that document's
 * tables; `test/survival.test.mjs` asserts them back against it as literals so
 * the two cannot drift silently.
 */

/**
 * Base water per day by dnd5e size key.
 *
 * The ruleset gives only Small, Medium and Large. dnd5e has six sizes, so
 * `tiny`, `huge` and `grg` continue the ruleset's doubling — they are this
 * module's extrapolation, not shipped rules. Nothing important rides on them:
 * the Huge creature a party actually travels with is a mekillot, and a
 * mekillot is priced by `SPECIES_WATER_GAL` below.
 * @type {Readonly<Record<string, number>>}
 */
export const SIZE_WATER_GAL = Object.freeze({
  tiny: 0.25,
  sm: 0.5,
  med: 1,
  lg: 4,
  huge: 16,
  grg: 64
});

/**
 * Water per day for named pack beasts.
 *
 * These override the size table and the override matters: a kank is Large, so
 * the size table would price it at 4 gal/day when the ruleset says 2. Getting
 * this backwards doubles every kank's thirst and roughly halves a crossing's
 * range. It was a real defect in the vault's falsification model before slice
 * 1 caught it.
 * @type {Readonly<Record<string, number>>}
 */
export const SPECIES_WATER_GAL = Object.freeze({
  kank: 2,
  inix: 8,
  mekillot: 16
});

/** A thri-kreen's whole weekly requirement. */
export const THRI_KREEN_WEEKLY_GAL = 1;

/**
 * Multipliers on the base requirement, applied together.
 * @type {Readonly<Record<string, number>>}
 */
export const WATER_MODIFIERS = Object.freeze({
  hot: 2,
  extreme: 4,
  night: 0.5,
  shaded: 0.5,
  inactive: 0.5,
  metalArmor: 2
});

/* -------------------------------------------- */

/**
 * Round up to the nearest quarter gallon.
 *
 * Always up: the desert does not give change.
 * @param {number} gal
 * @returns {number}
 */
export function roundQuarterGal(gal) {
  return Math.ceil(gal * 4) / 4;
}

/**
 * A creature's requirement before any of the day's modifiers.
 *
 * Resolution order is thri-kreen, then named species, then size. First match
 * wins, and the order is the point — see `SPECIES_WATER_GAL`.
 * @param {{size: string, species: string|null, isThriKreen: boolean}} creature
 * @returns {number} Gallons per day.
 */
export function baseWaterGal(creature) {
  if ( creature.isThriKreen ) return THRI_KREEN_WEEKLY_GAL / 7;

  const species = creature.species?.toLowerCase?.();
  if ( species && (species in SPECIES_WATER_GAL) ) return SPECIES_WATER_GAL[species];

  return SIZE_WATER_GAL[creature.size] ?? SIZE_WATER_GAL.med;
}

/**
 * A creature's water requirement for one day, modifiers applied and rounded.
 *
 * Thri-kreen ignore heat entirely, and are exempt from the quarter-gallon
 * rounding: 1/7 rounds up to 0.25, which would charge them 1.75 gallons a week
 * against a rule that says one. They still gain from night travel and shade.
 * @param {{size: string, species: string|null, isThriKreen: boolean, metalArmor: boolean}} creature
 * @param {{pace: "day"|"night"|"inactive", heat: "none"|"hot"|"extreme", shaded: boolean}} conditions
 * @returns {number} Gallons.
 */
export function dailyWaterGal(creature, conditions) {
  const base = baseWaterGal(creature);
  const travelled = conditions.pace !== "inactive";

  let mult = 1;

  // The ruleset's wording is "Travelled 1+ hour in heat above 100F". A
  // creature that stayed in camp did not trigger it, however hot the day was.
  if ( travelled && !creature.isThriKreen ) {
    if ( conditions.heat === "hot" ) mult *= WATER_MODIFIERS.hot;
    else if ( conditions.heat === "extreme" ) mult *= WATER_MODIFIERS.extreme;
  }

  if ( conditions.pace === "night" ) mult *= WATER_MODIFIERS.night;
  if ( conditions.pace === "inactive" ) mult *= WATER_MODIFIERS.inactive;
  if ( conditions.shaded ) mult *= WATER_MODIFIERS.shaded;
  if ( creature.metalArmor && !conditions.shaded ) mult *= WATER_MODIFIERS.metalArmor;

  const need = base * mult;
  return creature.isThriKreen ? need : roundQuarterGal(need);
}

/* -------------------------------------------- */
/*  Dehydration                                  */
/* -------------------------------------------- */

/** Exhaustion level 6 is death under the 2024 rules. */
export const MAX_EXHAUSTION = 6;

/** The save a creature gets when it drank at least half of what it needed. */
export const DEHYDRATION_SAVE_DC = 15;

/**
 * What a day of short rations does to a creature.
 *
 * `kind` is `"save"` when the creature gets a Constitution save to avoid the
 * level, and `"levels"` when it does not. In both cases `levels` is what lands
 * on a failure — the caller rolls, this function does not.
 *
 * @param {{requiredGal: number, drunkGal: number, currentExhaustion: number}} args
 * @returns {{kind: "none"|"save"|"levels", dc: number|null, levels: number}}
 */
export function dehydrationOutcome({ requiredGal, drunkGal, currentExhaustion }) {
  if ( requiredGal <= 0 || drunkGal >= requiredGal ) return { kind: "none", dc: null, levels: 0 };

  // Checked before the half comparison: zero is also "less than half", and
  // taking that branch would hand a creature that drank nothing the lighter
  // of the two penalties.
  if ( drunkGal <= 0 ) return { kind: "levels", dc: null, levels: 2 };

  if ( drunkGal >= (requiredGal / 2) ) {
    return { kind: "save", dc: DEHYDRATION_SAVE_DC, levels: 1 };
  }

  return { kind: "levels", dc: null, levels: currentExhaustion > 0 ? 2 : 1 };
}

/**
 * Add exhaustion without going past death.
 *
 * `applied` is what actually landed, which is not always what was asked for —
 * the chat card reports the difference so a GM can see that a character was
 * already at the ceiling.
 *
 * @param {number} current
 * @param {number} add
 * @returns {{final: number, applied: number, lethal: boolean}}
 */
export function clampExhaustion(current, add) {
  const from = Math.max(0, Math.min(MAX_EXHAUSTION, Number(current) || 0));
  const final = Math.min(MAX_EXHAUSTION, from + Math.max(0, Number(add) || 0));
  return { final, applied: final - from, lethal: final >= MAX_EXHAUSTION };
}

/* -------------------------------------------- */
/*  Resting                                      */
/* -------------------------------------------- */

/**
 * What a long rest is worth in this place.
 *
 * Removing a level needs all three of food, water and shelter. Hit point
 * recovery needs only shelter — without it a creature regains hit points by
 * spending Hit Dice and nothing more.
 *
 * This reports; it does not automate the rest. dnd5e owns resting.
 *
 * @param {{ateHalf: boolean, drankHalf: boolean, hadShelter: boolean}} args
 * @returns {{removesExhaustion: boolean, fullHpRecovery: boolean}}
 */
export function longRestVerdict({ ateHalf, drankHalf, hadShelter }) {
  return {
    removesExhaustion: Boolean(ateHalf && drankHalf && hadShelter),
    fullHpRecovery: Boolean(hadShelter)
  };
}

/* -------------------------------------------- */
/*  Supplies                                     */
/* -------------------------------------------- */

/** A waterskin's volume. Weighs 4 lb full. */
export const WATERSKIN_GAL = 0.5;

/** A beast- or wagon-borne cask. Weighs 85 lb full. */
export const CASK_GAL = 10;

/**
 * Gallons per unit for water items, keyed by dnd5e `system.identifier`.
 *
 * Identifiers rather than names: a name is localised, renamed by GMs, and
 * differs between the module's packs and dnd5e's.
 *
 * `water-1tun` is deliberately absent. The item exists in `dark-sun-items` but
 * is recorded at 1 lb, which cannot be a tun of anything, so its real volume
 * is unknown. Guessing 250 gallons would hand a party a quarter-tonne of water
 * it does not have. It counts as nothing until a GM flags it.
 * @type {Readonly<Record<string, number>>}
 */
export const WATER_ITEM_GAL = Object.freeze({
  "waterskin": WATERSKIN_GAL,          // dnd5e core
  "water-gallon": 1,                   // dark-sun-items
  "water-tun-250-gallons": 250,        // dark-sun-items
  "cask": CASK_GAL
});

/**
 * Waterskins a creature can physically carry, by size.
 *
 * A limit of bulk, not of weight: no amount of Strength adds a thirteenth
 * skin. Sizes absent from this table are limited by weight alone — a kank
 * carries casks, and what stops it is its 400 lb capacity.
 * @type {Readonly<Record<string, number>>}
 */
export const CONTAINER_CAP_SKINS = Object.freeze({
  sm: 6,
  med: 12
});

/**
 * Coerce the quantity field, which arrives from world data of any vintage.
 * @param {unknown} value
 * @returns {number}
 */
function readQuantity(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * How much water one item stack holds.
 *
 * An explicit `flagGal` always wins: it is how a world declares its own
 * containers without waiting for this table to learn about them.
 *
 * @param {{identifier: string|null, type: string|null, quantity: number, flagGal: number|null}} item
 * @returns {number} Gallons.
 */
export function waterGalForItem(item) {
  const quantity = readQuantity(item?.quantity);
  if ( !quantity ) return 0;

  const flagged = Number(item?.flagGal);
  if ( Number.isFinite(flagged) && flagged > 0 ) return flagged * quantity;

  const perUnit = WATER_ITEM_GAL[item?.identifier];
  return perUnit ? perUnit * quantity : 0;
}

/**
 * Total water across an inventory.
 * @param {Array<object>} items
 * @returns {number} Gallons.
 */
export function totalWaterGal(items) {
  return (items ?? []).reduce((sum, item) => sum + waterGalForItem(item), 0);
}

/**
 * The most water a creature of this size can carry on its person.
 * @param {string} size
 * @returns {number|null} Gallons, or null when the creature is weight-limited.
 */
export function containerCapGal(size) {
  const skins = CONTAINER_CAP_SKINS[size];
  return skins === undefined ? null : skins * WATERSKIN_GAL;
}
