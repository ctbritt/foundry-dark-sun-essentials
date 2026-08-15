import test from "node:test";
import assert from "node:assert/strict";

import {
  CASK_GAL,
  CONTAINER_CAP_SKINS,
  DEHYDRATION_SAVE_DC,
  MAX_EXHAUSTION,
  SIZE_WATER_GAL,
  SPECIES_WATER_GAL,
  THRI_KREEN_WEEKLY_GAL,
  WATERSKIN_GAL,
  WATER_ITEM_GAL,
  WATER_MODIFIERS,
  baseWaterGal,
  clampExhaustion,
  containerCapGal,
  dailyWaterGal,
  dehydrationOutcome,
  longRestVerdict,
  roundQuarterGal,
  totalWaterGal,
  waterGalForItem
} from "../scripts/core/survival.mjs";

/** A Medium human in no armour, the baseline every test varies from. */
const HUMAN = { size: "med", species: null, isThriKreen: false, metalArmor: false };
/** A calm day with no environmental modifiers — every modifier at rest. */
const MILD = { pace: "day", heat: "none", shaded: false };

/* -------------------------------------------- */
/*  Ruleset conformance                          */
/* -------------------------------------------- */

// 01-survival.md, "Water / Daily Need". Literals hand-copied from the
// ruleset table; if the ruleset changes, this test must fail. D-002.
test("size rates match the ruleset's Daily Need table", () => {
  assert.equal(SIZE_WATER_GAL.sm, 0.5, "Small: half a gallon");
  assert.equal(SIZE_WATER_GAL.med, 1, "Medium: one gallon");
  assert.equal(SIZE_WATER_GAL.lg, 4, "Large: four gallons");
});

// Not in the ruleset — the module's own extrapolation, continuing the
// doubling. Asserted so it cannot drift silently. See spec, "Computing a
// requirement".
test("sizes beyond the ruleset continue its doubling", () => {
  assert.equal(SIZE_WATER_GAL.tiny, 0.25);
  assert.equal(SIZE_WATER_GAL.huge, 16);
  assert.equal(SIZE_WATER_GAL.grg, 64);
});

// 01-survival.md, "Pack Beasts". D-007.
test("pack beast rates match the ruleset's Pack Beasts table", () => {
  assert.equal(SPECIES_WATER_GAL.kank, 2);
  assert.equal(SPECIES_WATER_GAL.inix, 8);
  assert.equal(SPECIES_WATER_GAL.mekillot, 16);
});

// 01-survival.md, "Water / Daily Need" and the modifier table. D-003, D-004.
test("modifiers match the ruleset's condition table", () => {
  assert.equal(THRI_KREEN_WEEKLY_GAL, 1);
  assert.equal(WATER_MODIFIERS.hot, 2);
  assert.equal(WATER_MODIFIERS.extreme, 4);
  assert.equal(WATER_MODIFIERS.night, 0.5);
  assert.equal(WATER_MODIFIERS.shaded, 0.5);
  assert.equal(WATER_MODIFIERS.inactive, 0.5);
  assert.equal(WATER_MODIFIERS.metalArmor, 2);
});

/* -------------------------------------------- */
/*  Species beats size                           */
/* -------------------------------------------- */

test("a kank drinks its species rate, not its Large size rate", () => {
  const kank = { size: "lg", species: "kank", isThriKreen: false, metalArmor: false };
  assert.equal(baseWaterGal(kank), 2, "2 gal/day, not the 4 a generic Large drinks");
  assert.notEqual(baseWaterGal(kank), SIZE_WATER_GAL.lg);
});

test("a mekillot drinks its species rate, not its Huge size rate", () => {
  const mek = { size: "huge", species: "mekillot", isThriKreen: false, metalArmor: false };
  assert.equal(baseWaterGal(mek), 16);
});

test("an unknown Large beast falls back to the size rate", () => {
  const beast = { size: "lg", species: "erdlu", isThriKreen: false, metalArmor: false };
  assert.equal(baseWaterGal(beast), 4);
});

/* -------------------------------------------- */
/*  Rounding                                     */
/* -------------------------------------------- */

test("requirements round up to the quarter gallon", () => {
  assert.equal(roundQuarterGal(0.1), 0.25);
  assert.equal(roundQuarterGal(0.25), 0.25, "already exact, unchanged");
  assert.equal(roundQuarterGal(0.26), 0.5);
  assert.equal(roundQuarterGal(1), 1);
  assert.equal(roundQuarterGal(2.01), 2.25);
});

/* -------------------------------------------- */
/*  Modifier stacking                            */
/* -------------------------------------------- */

test("a day march in 100F heat doubles the requirement", () => {
  assert.equal(dailyWaterGal(HUMAN, { pace: "day", heat: "hot", shaded: false }), 2);
});

test("extreme heat quadruples it", () => {
  assert.equal(dailyWaterGal(HUMAN, { pace: "day", heat: "extreme", shaded: false }), 4);
});

test("the same crossing at night costs half the day rate", () => {
  assert.equal(dailyWaterGal(HUMAN, { pace: "night", heat: "hot", shaded: false }), 1);
});

test("night plus shade stacks to a quarter", () => {
  assert.equal(dailyWaterGal(HUMAN, { pace: "night", heat: "hot", shaded: true }), 0.5);
});

// 01-survival.md: the modifier reads "Travelled 1+ hour in heat above 100F".
// A creature that did not travel did not trigger it.
test("heat does not apply to a creature that stayed put", () => {
  assert.equal(dailyWaterGal(HUMAN, { pace: "inactive", heat: "extreme", shaded: false }), 0.5);
});

test("metal armour doubles the requirement, but only without shade", () => {
  const armoured = { ...HUMAN, metalArmor: true };
  assert.equal(dailyWaterGal(armoured, { pace: "day", heat: "hot", shaded: false }), 4);
  assert.equal(dailyWaterGal(armoured, { pace: "day", heat: "hot", shaded: true }), 1,
    "shade cancels the armour penalty and halves the base");
});

/* -------------------------------------------- */
/*  Thri-kreen                                   */
/* -------------------------------------------- */

const KREEN = { size: "med", species: null, isThriKreen: true, metalArmor: false };

test("a thri-kreen needs a seventh of a gallon a day", () => {
  assert.equal(dailyWaterGal(KREEN, MILD), THRI_KREEN_WEEKLY_GAL / 7);
});

test("a thri-kreen ignores heat entirely", () => {
  assert.equal(dailyWaterGal(KREEN, { pace: "day", heat: "extreme", shaded: false }),
    THRI_KREEN_WEEKLY_GAL / 7);
});

// The exemption exists because 1/7 rounded up to the quarter is 0.25, which
// is 1.75 gal/week -- a 75% tax on the one race whose trait is not needing
// water. See spec, "Thri-kreen and rounding".
test("a thri-kreen is exempt from quarter-gallon rounding", () => {
  const perDay = dailyWaterGal(KREEN, MILD);
  assert.ok(perDay < 0.25, `${perDay} must stay below the rounding floor`);
  assert.equal(perDay * 7, 1, "seven days total exactly one gallon");
});

test("a thri-kreen still benefits from night travel and shade", () => {
  assert.equal(dailyWaterGal(KREEN, { pace: "night", heat: "none", shaded: true }),
    (THRI_KREEN_WEEKLY_GAL / 7) * 0.25);
});

/* -------------------------------------------- */
/*  Dehydration                                  */
/* -------------------------------------------- */

// 01-survival.md, "Dehydration". D-005.
test("drinking the full requirement costs nothing", () => {
  const out = dehydrationOutcome({ requiredGal: 2, drunkGal: 2, currentExhaustion: 0 });
  assert.equal(out.kind, "none");
  assert.equal(out.levels, 0);
});

test("drinking more than needed is still nothing", () => {
  const out = dehydrationOutcome({ requiredGal: 2, drunkGal: 5, currentExhaustion: 0 });
  assert.equal(out.kind, "none");
});

test("half or more calls for a DC 15 Constitution save", () => {
  const out = dehydrationOutcome({ requiredGal: 2, drunkGal: 1, currentExhaustion: 0 });
  assert.equal(out.kind, "save");
  assert.equal(out.dc, DEHYDRATION_SAVE_DC);
  assert.equal(out.dc, 15);
  assert.equal(out.levels, 1, "one level, on a failed save");
});

test("less than half is one level with no save", () => {
  const out = dehydrationOutcome({ requiredGal: 2, drunkGal: 0.5, currentExhaustion: 0 });
  assert.equal(out.kind, "levels");
  assert.equal(out.dc, null);
  assert.equal(out.levels, 1);
});

test("less than half is two levels if already exhausted at all", () => {
  const out = dehydrationOutcome({ requiredGal: 2, drunkGal: 0.5, currentExhaustion: 1 });
  assert.equal(out.levels, 2, "the spiral is the point");
});

test("no water at all is two levels regardless of prior exhaustion", () => {
  assert.equal(dehydrationOutcome({ requiredGal: 2, drunkGal: 0, currentExhaustion: 0 }).levels, 2);
  assert.equal(dehydrationOutcome({ requiredGal: 2, drunkGal: 0, currentExhaustion: 3 }).levels, 2);
});

// Ordering guard: zero is also "less than half", so the none-at-all branch
// has to be checked first or a parched creature gets the lighter penalty.
test("zero intake takes the none-at-all branch, not the less-than-half branch", () => {
  const out = dehydrationOutcome({ requiredGal: 2, drunkGal: 0, currentExhaustion: 0 });
  assert.equal(out.levels, 2, "not 1");
});

test("a creature that needs no water cannot be dehydrated", () => {
  const out = dehydrationOutcome({ requiredGal: 0, drunkGal: 0, currentExhaustion: 0 });
  assert.equal(out.kind, "none");
});

/* -------------------------------------------- */
/*  Exhaustion clamping                          */
/* -------------------------------------------- */

test("exhaustion stops at six", () => {
  assert.equal(MAX_EXHAUSTION, 6);
  const out = clampExhaustion(5, 2);
  assert.equal(out.final, 6);
  assert.equal(out.applied, 1, "only one level actually landed");
  assert.equal(out.lethal, true);
});

test("reaching exactly six is lethal", () => {
  assert.equal(clampExhaustion(4, 2).lethal, true);
});

test("staying below six is not lethal", () => {
  const out = clampExhaustion(2, 2);
  assert.equal(out.final, 4);
  assert.equal(out.applied, 2);
  assert.equal(out.lethal, false);
});

test("a creature already at six cannot be pushed further", () => {
  const out = clampExhaustion(6, 2);
  assert.equal(out.final, 6);
  assert.equal(out.applied, 0);
});

/* -------------------------------------------- */
/*  Long rest                                    */
/* -------------------------------------------- */

// 01-survival.md, "Resting". D-008. All eight combinations, because the
// three-way AND is exactly the kind of thing that gets refactored into a
// two-way one.
test("a long rest removes a level only with food, water and shelter", () => {
  const cases = [
    [true,  true,  true,  true ],
    [true,  true,  false, false],
    [true,  false, true,  false],
    [false, true,  true,  false],
    [true,  false, false, false],
    [false, true,  false, false],
    [false, false, true,  false],
    [false, false, false, false]
  ];
  for ( const [ateHalf, drankHalf, hadShelter, expected] of cases ) {
    const out = longRestVerdict({ ateHalf, drankHalf, hadShelter });
    assert.equal(out.removesExhaustion, expected,
      `ate=${ateHalf} drank=${drankHalf} shelter=${hadShelter}`);
  }
});

test("hit point recovery depends on shelter alone", () => {
  assert.equal(longRestVerdict({ ateHalf: false, drankHalf: false, hadShelter: true }).fullHpRecovery, true);
  assert.equal(longRestVerdict({ ateHalf: true, drankHalf: true, hadShelter: false }).fullHpRecovery, false);
});

/** Build a plain item the way `scripts/survival.mjs` will. */
function item(identifier, quantity = 1, { type = "drink", flagGal = null } = {}) {
  return { identifier, type, quantity, flagGal };
}

/* -------------------------------------------- */
/*  Identifying water                            */
/* -------------------------------------------- */

test("known water items carry their ruleset volume", () => {
  assert.equal(WATER_ITEM_GAL.waterskin, 0.5);
  assert.equal(WATER_ITEM_GAL["water-gallon"], 1);
  assert.equal(WATER_ITEM_GAL["water-tun-250-gallons"], 250);
});

// 01-survival.md, "Containers". D-006.
test("container volumes match the ruleset", () => {
  assert.equal(WATERSKIN_GAL, 0.5);
  assert.equal(CASK_GAL, 10);
});

test("a stack multiplies by quantity", () => {
  assert.equal(waterGalForItem(item("waterskin", 12)), 6, "the Medium carrying limit");
  assert.equal(waterGalForItem(item("water-gallon", 4)), 4);
});

test("an item flag overrides the identifier table", () => {
  assert.equal(waterGalForItem(item("waterskin", 2, { flagGal: 3 })), 6,
    "a world's own container wins over the built-in guess");
});

test("a flag works on an item the table has never heard of", () => {
  assert.equal(waterGalForItem(item("bloodgourd", 2, { flagGal: 0.25 })), 0.5);
});

test("non-water items hold no water", () => {
  assert.equal(waterGalForItem(item("rations-15-days", 3, { type: "food" })), 0);
  assert.equal(waterGalForItem(item("obsidian-dagger", 1, { type: null })), 0);
  assert.equal(waterGalForItem(item(null, 1, { type: null })), 0);
});

// `water-1tun` is recorded in dark-sun-items at weight 1 lb, which cannot be
// 250 gallons of anything. Left out of the table deliberately rather than
// guessed at. See spec, "Known data defects".
test("the ambiguous water-1tun item is not guessed at", () => {
  assert.equal(WATER_ITEM_GAL["water-1tun"], undefined);
  assert.equal(waterGalForItem(item("water-1tun", 1)), 0,
    "counts as nothing until a GM flags it, rather than silently inventing supply");
});

test("junk quantities coerce rather than poison the total", () => {
  assert.equal(waterGalForItem(item("water-gallon", "3")), 3);
  assert.equal(waterGalForItem(item("water-gallon", null)), 0);
  assert.equal(waterGalForItem(item("water-gallon", -2)), 0, "negatives cannot create water");
  assert.equal(waterGalForItem(item("water-gallon", NaN)), 0);
});

test("totalWaterGal sums a mixed inventory", () => {
  const inventory = [
    item("waterskin", 12),
    item("water-gallon", 2),
    item("rations-15-days", 5, { type: "food" }),
    item("water-1tun", 1)
  ];
  assert.equal(totalWaterGal(inventory), 8, "6 from skins, 2 from gallons, nothing else");
});

test("an empty inventory is zero, not an error", () => {
  assert.equal(totalWaterGal([]), 0);
});

/* -------------------------------------------- */
/*  Container caps                               */
/* -------------------------------------------- */

// 01-survival.md, "Carrying Water". D-006 — a limit of bulk, not weight.
test("carrying limits are bulk, not weight", () => {
  assert.equal(CONTAINER_CAP_SKINS.med, 12);
  assert.equal(CONTAINER_CAP_SKINS.sm, 6);
  assert.equal(containerCapGal("med"), 6, "12 skins at half a gallon");
  assert.equal(containerCapGal("sm"), 3);
});

test("beasts are limited by weight, so they have no bulk cap", () => {
  assert.equal(containerCapGal("lg"), null);
  assert.equal(containerCapGal("huge"), null);
});
