import test from "node:test";
import assert from "node:assert/strict";

import {
  SIZE_WATER_GAL,
  SPECIES_WATER_GAL,
  THRI_KREEN_WEEKLY_GAL,
  WATER_MODIFIERS,
  baseWaterGal,
  dailyWaterGal,
  roundQuarterGal
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
