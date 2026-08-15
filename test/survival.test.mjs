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
  buildDayPlan,
  clampExhaustion,
  containerCapGal,
  dailyWaterGal,
  dehydrationOutcome,
  identifySpecies,
  longRestVerdict,
  normaliseSpeciesText,
  roundQuarterGal,
  totalWaterGal,
  waterBreakdown,
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
/*  Species identification                       */
/* -------------------------------------------- */

// Names as they actually appear in packs/src/dark-sun-creature-catalog/,
// where every statblock has `race: null` and is identifiable only by name.
test("shipped kank statblock names all identify as kank", () => {
  for ( const name of ["Kank, Drone", "Kank, Soldier", "Kank (version 2)", "Kank"] ) {
    assert.equal(identifySpecies([null, null, name]).species, "kank", name);
  }
});

test("shipped inix statblock names all identify as inix", () => {
  for ( const name of ["Inix Adult", "Inix Juvenile", "Inix"] ) {
    assert.equal(identifySpecies([null, null, name]).species, "inix", name);
  }
});

test("shipped mekillot statblock names identify as mekillot", () => {
  for ( const name of ["Mekillot Dirk", "Mekillot"] ) {
    assert.equal(identifySpecies([null, null, name]).species, "mekillot", name);
  }
});

// D-002 regression: the shipped origin item's identifier is
// `athas-thri-kreen`, which contains neither "thri-kreen" nor "thrikreen"
// under a naive equality check — a thri-kreen was charged 1 gal/day instead
// of 1 gal/week, sevenfold, silently.
test("the shipped thri-kreen identifier is athas-thri-kreen, not thri-kreen", () => {
  const result = identifySpecies(["athas-thri-kreen", null, null]);
  assert.equal(result.isThriKreen, true);
  assert.equal(result.species, null);
});

test("both shipped thri-kreen origin item names identify as thri-kreen", () => {
  assert.equal(identifySpecies([null, "Thri-Kreen", null]).isThriKreen, true);
  assert.equal(identifySpecies([null, "Thri-kreen (Dark Sun)", null]).isThriKreen, true);
});

test("all-null candidates identify as nothing", () => {
  assert.deepEqual(identifySpecies([null, null, null]), { species: null, isThriKreen: false });
});

test("an unrelated name identifies as nothing", () => {
  assert.deepEqual(identifySpecies([null, null, "Erdlu"]), { species: null, isThriKreen: false });
});

test("race information beats actor name", () => {
  const result = identifySpecies(["athas-thri-kreen", null, "Kank"]);
  assert.equal(result.isThriKreen, true, "not mistaken for a kank because the name says Kank");
  assert.equal(result.species, null);
});

test("normaliseSpeciesText strips punctuation, spacing and case", () => {
  assert.equal(normaliseSpeciesText("Kank, Drone"), "kankdrone");
  assert.equal(normaliseSpeciesText("Thri-kreen (Dark Sun)"), "thrikreendarksun");
  assert.equal(normaliseSpeciesText(null), "");
  assert.equal(normaliseSpeciesText(undefined), "");
  assert.equal(normaliseSpeciesText(42), "");
});

// The end-to-end consequence: a mismatch here is not an abstract string bug,
// it is the price a kank is charged. A regression in identifySpecies should
// show up as this number changing, not just as a failing string assertion.
test("a Large creature identified as a kank is charged 2 gal/day; unidentified, 4", () => {
  const identified = identifySpecies([null, null, "Kank, Drone"]);
  const known = { size: "lg", ...identified, metalArmor: false };
  assert.equal(baseWaterGal(known), 2, "the species rate, not the size rate");

  const unidentified = { size: "lg", species: null, isThriKreen: false, metalArmor: false };
  assert.equal(baseWaterGal(unidentified), 4, "silently double, if species identification regresses");
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
/*  Shelter is shade, for water                  */
/* -------------------------------------------- */

// 01-survival.md's modifier row reads "Under shade OR shelter the whole day".
// The dialog asks the two questions separately because a long rest needs
// shelter and shade will not do, but for water they are one modifier. A party
// holed up in a cave was being charged twice what the ruleset says.
test("shelter halves water even when nothing is marked shaded", () => {
  assert.equal(dailyWaterGal(HUMAN, { pace: "day", heat: "hot", shaded: false, sheltered: true }), 1,
    "2 gal for a hot day march, halved by the cave");
});

test("shelter suppresses the metal armour penalty exactly as shade does", () => {
  const armoured = { ...HUMAN, metalArmor: true };
  assert.equal(dailyWaterGal(armoured, { pace: "day", heat: "hot", shaded: false, sheltered: true }), 1,
    "the same 1 gal shade produces, not 2");
});

test("shade and shelter together halve once, not twice", () => {
  assert.equal(dailyWaterGal(HUMAN, { pace: "day", heat: "hot", shaded: true, sheltered: true }), 1);
  assert.deepEqual(
    waterBreakdown(HUMAN, { pace: "day", heat: "hot", shaded: true, sheltered: true }).modifiers,
    ["hot", "shaded"], "one shade modifier, however many boxes are ticked");
});

/* -------------------------------------------- */
/*  Showing the working                          */
/* -------------------------------------------- */

// The card renders this so a mis-identified species is visible as a wrong
// base rate rather than as an unremarkable number. See I3.
const HOT_MARCH = { pace: "day", heat: "hot", shaded: false };

test("a Medium human's hot day march derives from a 1 gal base", () => {
  const out = waterBreakdown(HUMAN, HOT_MARCH);
  assert.equal(out.requiredGal, 2);
  assert.equal(out.baseGal, 1);
  assert.deepEqual(out.modifiers, ["hot"]);
});

test("a kank's same day derives from a 2 gal base, not the 4 its size would give", () => {
  const kank = { size: "lg", species: "kank", isThriKreen: false, metalArmor: false };
  const out = waterBreakdown(kank, HOT_MARCH);
  assert.equal(out.requiredGal, 4);
  assert.equal(out.baseGal, 2, "a 4 here is the mispricing the card exists to expose");
  assert.deepEqual(out.modifiers, ["hot"]);
});

test("a thri-kreen derives from a seventh of a gallon and takes no modifiers", () => {
  const kreen = { size: "med", species: null, isThriKreen: true, metalArmor: false };
  const out = waterBreakdown(kreen, HOT_MARCH);
  assert.equal(out.baseGal, 1 / 7);
  assert.equal(out.requiredGal, 1 / 7);
  assert.deepEqual(out.modifiers, [], "heat does not touch a thri-kreen");
});

test("every modifier name is a key of the published multiplier table", () => {
  // The card looks each name up in WATER_MODIFIERS to print its factor. A
  // name that is not a key there renders as "×undefined".
  const armoured = { ...HUMAN, metalArmor: true };
  const seen = new Set([
    ...waterBreakdown(armoured, { pace: "day", heat: "hot", shaded: false }).modifiers,
    ...waterBreakdown(armoured, { pace: "night", heat: "extreme", shaded: true }).modifiers,
    ...waterBreakdown(armoured, { pace: "inactive", heat: "none", shaded: false }).modifiers
  ]);
  assert.deepEqual([...seen].filter(n => !(n in WATER_MODIFIERS)), []);
  assert.ok(seen.size >= 5, `expected most of the table exercised, saw ${[...seen]}`);
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
function item(identifier, quantity = 1, { flagGal = null } = {}) {
  return { identifier, quantity, flagGal };
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

// Identification is by identifier alone — an item's dnd5e type is never
// consulted, so what this asserts is that an unrecognised or absent
// identifier contributes nothing, not that "food" is excluded as food.
test("an identifier the water table does not know contributes nothing", () => {
  assert.equal(waterGalForItem(item("rations-15-days", 3)), 0);
  assert.equal(waterGalForItem(item("obsidian-dagger", 1)), 0);
  assert.equal(waterGalForItem(item(null, 1)), 0);
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
    item("rations-15-days", 5),
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

/** The party from the cheat sheet, minus the bookkeeping. */
function member(name, overrides = {}) {
  return {
    id: name.toLowerCase(),
    uuid: `Actor.${name.toLowerCase()}`,
    name,
    size: "med",
    species: null,
    isThriKreen: false,
    metalArmor: false,
    currentExhaustion: 0,
    drunkGal: null,        // null means "drank the full requirement"
    items: [],
    ...overrides
  };
}

const DAY_MARCH = { pace: "day", heat: "hot", shaded: false };

test("a plan has one row per member, in order", () => {
  const plan = buildDayPlan({
    members: [member("Itilda"), member("Kaine")],
    conditions: DAY_MARCH
  });
  assert.equal(plan.rows.length, 2);
  assert.deepEqual(plan.rows.map(r => r.name), ["Itilda", "Kaine"]);
});

// C3: `applyPlan` resolves the actor by uuid, because `game.actors.get(id)`
// cannot reach an unlinked token's synthetic actor — and every pack beast this
// module ships is one. If the uuid does not survive the trip from member to
// row, exhaustion lands on the sidebar prototype instead, silently.
test("a member's uuid reaches its row", () => {
  const plan = buildDayPlan({
    members: [
      member("Itilda", { uuid: "Scene.abc.Token.def.Actor.ghi" }),
      member("Kaine")
    ],
    conditions: DAY_MARCH
  });
  assert.equal(plan.rows[0].uuid, "Scene.abc.Token.def.Actor.ghi");
  assert.equal(plan.rows[1].uuid, "Actor.kaine");
});

test("a member with no uuid gets an explicit null, never undefined", () => {
  const anonymous = member("Nomad");
  delete anonymous.uuid;
  const plan = buildDayPlan({ members: [anonymous], conditions: DAY_MARCH });
  assert.equal(plan.rows[0].uuid, null, "so applyPlan falls back to the id rather than throwing");
  assert.equal(plan.rows[0].id, "nomad");
});

test("a row carries the working behind its requirement", () => {
  const plan = buildDayPlan({
    members: [member("Kank #1", { size: "lg", species: "kank" })],
    conditions: DAY_MARCH
  });
  assert.deepEqual(plan.rows[0].derivation, { baseGal: 2, modifiers: ["hot"] });
});

test("a null intake means the member drank exactly what they needed", () => {
  const plan = buildDayPlan({ members: [member("Itilda")], conditions: DAY_MARCH });
  const [row] = plan.rows;
  assert.equal(row.requiredGal, 2);
  assert.equal(row.drunkGal, 2);
  assert.equal(row.outcome.kind, "none");
  assert.equal(row.projected.applied, 0);
});

test("a short drink projects the exhaustion it would cause", () => {
  const plan = buildDayPlan({
    members: [member("Kaine", { drunkGal: 1, currentExhaustion: 0 })],
    conditions: DAY_MARCH
  });
  const [row] = plan.rows;
  assert.equal(row.requiredGal, 2);
  assert.equal(row.outcome.kind, "save");
  assert.equal(row.outcome.dc, 15);
  assert.equal(row.projected.final, 1, "the level that lands if the save fails");
});

test("a member already at five is projected into death, and it is flagged", () => {
  const plan = buildDayPlan({
    members: [member("Rickvon", { drunkGal: 0, currentExhaustion: 5 })],
    conditions: DAY_MARCH
  });
  const [row] = plan.rows;
  assert.equal(row.projected.final, 6);
  assert.equal(row.projected.lethal, true, "the card must be able to say death");
  assert.equal(row.projected.applied, 1, "only one level had anywhere to go");
});

test("pack beasts appear as ordinary rows at their species rate", () => {
  const plan = buildDayPlan({
    members: [member("Kank #1", { size: "lg", species: "kank" })],
    conditions: DAY_MARCH
  });
  assert.equal(plan.rows[0].requiredGal, 4, "2 gal base, doubled by the heat");
});

test("a thri-kreen row survives the same day on a fraction", () => {
  const plan = buildDayPlan({
    members: [member("Shadow", { isThriKreen: true })],
    conditions: DAY_MARCH
  });
  assert.equal(plan.rows[0].requiredGal, 1 / 7);
});

/* -------------------------------------------- */
/*  Totals                                       */
/* -------------------------------------------- */

test("totals sum requirement, intake and supply", () => {
  const plan = buildDayPlan({
    members: [
      member("Itilda", { items: [{ identifier: "waterskin", quantity: 12, flagGal: null }] }),
      member("Kank #1", {
        size: "lg", species: "kank",
        items: [{ identifier: "cask", quantity: 4, flagGal: null }]
      })
    ],
    conditions: DAY_MARCH
  });
  assert.equal(plan.totals.requiredGal, 6, "2 for the human, 4 for the kank");
  assert.equal(plan.totals.drunkGal, 6);
  assert.equal(plan.totals.supplyGal, 46, "6 gal of skins, 40 gal of casks");
});

test("days of supply is the honest floor, not a rounded-up promise", () => {
  const plan = buildDayPlan({
    members: [member("Itilda", {
      items: [{ identifier: "water-gallon", quantity: 5, flagGal: null }]
    })],
    conditions: DAY_MARCH
  });
  assert.equal(plan.totals.requiredGal, 2);
  assert.equal(plan.totals.supplyGal, 5);
  assert.equal(plan.totals.daysOfSupply, 2, "2.5 days floors to 2 whole days");
});

test("days of supply is null when nothing needs water", () => {
  const plan = buildDayPlan({ members: [], conditions: DAY_MARCH });
  assert.equal(plan.totals.daysOfSupply, null);
  assert.equal(plan.totals.requiredGal, 0);
});

/* -------------------------------------------- */
/*  Container cap                                */
/* -------------------------------------------- */

test("a Medium carrying more than twelve skins is flagged", () => {
  const plan = buildDayPlan({
    members: [member("Kaine", {
      items: [{ identifier: "waterskin", quantity: 20, flagGal: null }]
    })],
    conditions: DAY_MARCH
  });
  assert.equal(plan.rows[0].capExceeded, true, "10 gal on a 6 gal frame");
});

test("a beast carrying casks is never flagged, being weight-limited", () => {
  const plan = buildDayPlan({
    members: [member("Kank #1", {
      size: "lg", species: "kank",
      items: [{ identifier: "cask", quantity: 30, flagGal: null }]
    })],
    conditions: DAY_MARCH
  });
  assert.equal(plan.rows[0].capExceeded, false);
});

test("the conditions travel with the plan so the card cannot misreport them", () => {
  const plan = buildDayPlan({ members: [member("Itilda")], conditions: DAY_MARCH });
  assert.deepEqual(plan.conditions, DAY_MARCH);
});

/* -------------------------------------------- */
/*  Saves are owed, never rolled                 */
/* -------------------------------------------- */

// applyPlan reads row.saveFailed. If buildDayPlan did not initialise it, an
// undefined would read as "passed" and every DC 15 save in the game would
// silently resolve in the party's favour.
test("a row owing a save starts with the save unfailed, not undefined", () => {
  const plan = buildDayPlan({
    members: [member("Kaine", { drunkGal: 1 })],
    conditions: DAY_MARCH
  });
  assert.equal(plan.rows[0].outcome.kind, "save");
  assert.equal(plan.rows[0].saveFailed, false, "explicitly false, never undefined");
});

test("rows that owe no save still carry the field", () => {
  const plan = buildDayPlan({ members: [member("Itilda")], conditions: DAY_MARCH });
  assert.equal(plan.rows[0].saveFailed, false);
});

/* -------------------------------------------- */
/*  Long rest, per member                        */
/* -------------------------------------------- */

const CAMPED = { pace: "day", heat: "hot", shaded: false, sheltered: true, ateHalf: true };

test("a fed, watered, sheltered member recovers a level tonight", () => {
  const plan = buildDayPlan({ members: [member("Itilda")], conditions: CAMPED });
  assert.equal(plan.rows[0].rest.removesExhaustion, true);
});

test("a member who drank less than half recovers nothing, even in shelter", () => {
  const plan = buildDayPlan({
    members: [member("Kaine", { drunkGal: 0.25 })],
    conditions: CAMPED
  });
  // 2 gal for a hot day march, halved to 1 by the shelter, so half is 0.5.
  assert.equal(plan.rows[0].requiredGal, 1);
  assert.equal(plan.rows[0].rest.removesExhaustion, false, "1 gal needed, 0.25 drunk");
});

test("without shelter nobody recovers and hit points come from Hit Dice", () => {
  const plan = buildDayPlan({
    members: [member("Itilda")],
    conditions: { ...CAMPED, sheltered: false }
  });
  assert.equal(plan.rows[0].rest.removesExhaustion, false);
  assert.equal(plan.rows[0].rest.fullHpRecovery, false);
});

test("shade is not shelter", () => {
  const plan = buildDayPlan({
    members: [member("Itilda")],
    conditions: { ...CAMPED, shaded: true, sheltered: false }
  });
  assert.equal(plan.rows[0].rest.fullHpRecovery, false,
    "a sun cloak over the day camp is not a cave");
});
