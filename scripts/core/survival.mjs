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
/*  Species identification                       */
/* -------------------------------------------- */

/**
 * Lowercase and strip everything but letters and digits.
 *
 * The strings this module has to compare disagree wildly on spacing,
 * punctuation and case — "Kank, Drone", "athas-thri-kreen",
 * "Thri-Kreen (Dark Sun)". Reducing all of them to bare alphanumerics makes
 * simple substring containment a reliable way to compare them.
 *
 * @param {unknown} text
 * @returns {string} "" for null, undefined, or any non-string.
 */
export function normaliseSpeciesText(text) {
  if ( typeof text !== "string" ) return "";
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Identify a species, and whether it is a thri-kreen, from a list of
 * candidate strings.
 *
 * This exists because the adapter's naive `race.identifier` read guesses
 * wrong against this module's own shipped data: every pack-beast statblock
 * in the creature catalog has `race: null` and is identifiable only by
 * name ("Kank, Drone", "Mekillot Dirk"), and the shipped thri-kreen origin
 * item's identifier is `athas-thri-kreen`, which contains neither
 * "thri-kreen" nor "thrikreen" as those were being compared naively. Both
 * defects were silent: a kank was charged double, a thri-kreen sevenfold.
 *
 * Thri-kreen are checked across every candidate before the species table is
 * consulted at all — a wrong thri-kreen miss is the more expensive defect
 * (7x vs 2x), so it must not lose to an earlier, weaker species-table match.
 * Once past that check, candidates are tried against `SPECIES_WATER_GAL` in
 * order and the first one that contains a table key wins — callers are
 * expected to pass their most-trusted candidate (e.g. a race item's
 * identifier) first, so a player character's own name cannot be mistaken
 * for livestock when a real race item is available.
 *
 * @param {Array<string|null|undefined>} candidates
 * @returns {{species: string|null, isThriKreen: boolean}}
 */
export function identifySpecies(candidates) {
  const normalised = (candidates ?? []).map(normaliseSpeciesText);

  if ( normalised.some(c => c.includes("thrikreen")) ) {
    return { species: null, isThriKreen: true };
  }

  for ( const candidate of normalised ) {
    if ( !candidate ) continue;
    const match = Object.keys(SPECIES_WATER_GAL).find(key => candidate.includes(key));
    if ( match ) return { species: match, isThriKreen: false };
  }

  return { species: null, isThriKreen: false };
}

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
 * A creature's requirement for one day, with the working shown.
 *
 * The `modifiers` list is why this exists: species detection matches on
 * substrings, so a wrong match is possible, and the agreed mitigation was that
 * the chat card previews every computed requirement. A bare number does not
 * preview anything — a kank mispriced at 4 instead of 2 looks like the number
 * 4. Returning the base rate and the multipliers that were applied lets the
 * card render "4 (2 base ×2 heat)", where a wrong base is obvious on sight.
 *
 * Names in `modifiers` are keys of `WATER_MODIFIERS`, so a caller can look the
 * factor up rather than being told it twice.
 *
 * Thri-kreen ignore heat entirely, and are exempt from the quarter-gallon
 * rounding: 1/7 rounds up to 0.25, which would charge them 1.75 gallons a week
 * against a rule that says one. They still gain from night travel and shade.
 *
 * @param {{size: string, species: string|null, isThriKreen: boolean, metalArmor: boolean}} creature
 * @param {{pace: "day"|"night"|"inactive", heat: "none"|"hot"|"extreme", shaded: boolean, sheltered: boolean}} conditions
 * @returns {{requiredGal: number, baseGal: number, modifiers: string[]}}
 */
export function waterBreakdown(creature, conditions) {
  const base = baseWaterGal(creature);
  const travelled = conditions.pace !== "inactive";
  const modifiers = [];

  let mult = 1;

  // The ruleset's wording is "Travelled 1+ hour in heat above 100F". A
  // creature that stayed in camp did not trigger it, however hot the day was.
  if ( travelled && !creature.isThriKreen ) {
    if ( conditions.heat === "hot" ) modifiers.push("hot");
    else if ( conditions.heat === "extreme" ) modifiers.push("extreme");
  }

  if ( conditions.pace === "night" ) modifiers.push("night");
  if ( conditions.pace === "inactive" ) modifiers.push("inactive");

  // The ruleset's row reads "Under shade OR shelter the whole day — x1/2".
  // Shelter is asked for separately on the dialog because a long rest needs it
  // and shade does not, but for water the two are the same modifier: a party
  // holed up in a cave is out of the sun by definition.
  const covered = conditions.shaded || conditions.sheltered;
  if ( covered ) modifiers.push("shaded");
  if ( creature.metalArmor && !covered ) modifiers.push("metalArmor");

  for ( const name of modifiers ) mult *= WATER_MODIFIERS[name];

  const need = base * mult;
  return {
    requiredGal: creature.isThriKreen ? need : roundQuarterGal(need),
    baseGal: base,
    modifiers
  };
}

/**
 * A creature's water requirement for one day, modifiers applied and rounded.
 * @param {{size: string, species: string|null, isThriKreen: boolean, metalArmor: boolean}} creature
 * @param {{pace: "day"|"night"|"inactive", heat: "none"|"hot"|"extreme", shaded: boolean, sheltered: boolean}} conditions
 * @returns {number} Gallons.
 */
export function dailyWaterGal(creature, conditions) {
  return waterBreakdown(creature, conditions).requiredGal;
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
 * @param {{identifier: string|null, quantity: number, flagGal: number|null}} item
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

/* -------------------------------------------- */
/*  The day                                      */
/* -------------------------------------------- */

/**
 * Resolve one day for a whole party, without touching anything.
 *
 * The returned plan is the single artifact the rest of the feature moves
 * around: the dialog builds its input, the chat card renders it, and Apply
 * consumes it. Apply re-reads this object rather than recomputing, so what a
 * GM approves is exactly what lands — a setting changed between preview and
 * commit cannot alter the outcome behind their back.
 *
 * Nothing here rolls dice. A row whose `outcome.kind` is `"save"` is telling
 * the caller a save is owed, not that it failed.
 *
 * @param {{members: Array<object>, conditions: object}} args
 * @returns {{conditions: object, rows: Array<object>, totals: object}}
 */
export function buildDayPlan({ members, conditions }) {
  const rows = (members ?? []).map(m => {
    const { requiredGal, baseGal, modifiers } = waterBreakdown(m, conditions);

    // A null intake is the dialog's default: the member drank their fill.
    // Distinguished from 0, which is a creature that drank nothing at all.
    const drunkGal = (m.drunkGal === null || m.drunkGal === undefined)
      ? requiredGal
      : Math.max(0, Number(m.drunkGal) || 0);

    const outcome = dehydrationOutcome({
      requiredGal,
      drunkGal,
      currentExhaustion: m.currentExhaustion
    });

    const carried = totalWaterGal(m.items);
    const cap = containerCapGal(m.size);

    return {
      id: m.id,

      // Carried alongside `id` because `id` cannot address an unlinked token's
      // synthetic actor, and every pack beast this module ships lands on a
      // scene as one. `applyPlan` resolves this first. `id` stays because the
      // card's failed-save checkboxes are keyed on it.
      uuid: m.uuid ?? null,
      name: m.name,
      requiredGal,
      drunkGal,

      // The working behind `requiredGal`, for the card to render. See
      // `waterBreakdown`.
      derivation: { baseGal, modifiers },
      outcome,
      projected: clampExhaustion(m.currentExhaustion, outcome.levels),
      capExceeded: cap !== null && carried > cap,

      // What a long rest here would be worth. Reported, not automated —
      // dnd5e owns resting. `drankHalf` is per member; food and shelter are
      // party-level facts the GM asserts on the dialog.
      rest: longRestVerdict({
        ateHalf: Boolean(conditions.ateHalf),
        drankHalf: requiredGal <= 0 || drunkGal >= (requiredGal / 2),
        hadShelter: Boolean(conditions.sheltered)
      }),

      // Initialised explicitly. `applyPlan` reads this to decide whether a
      // save was failed, and an undefined would read as "passed" — every DC
      // 15 save in the game would silently resolve in the party's favour.
      saveFailed: false
    };
  });

  const requiredGal = rows.reduce((sum, r) => sum + r.requiredGal, 0);
  const drunkGal = rows.reduce((sum, r) => sum + r.drunkGal, 0);
  const supplyGal = (members ?? []).reduce((sum, m) => sum + totalWaterGal(m.items), 0);

  return {
    conditions,
    rows,
    totals: {
      requiredGal,
      drunkGal,
      supplyGal,
      // Floored: a party with two and a half days of water has two days it
      // can count on. Rounding up here would be the module lying about the
      // one number a GM plans the crossing around.
      daysOfSupply: requiredGal > 0 ? Math.floor(supplyGal / requiredGal) : null
    }
  };
}
