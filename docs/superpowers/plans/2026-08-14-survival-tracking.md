# Survival Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a GM resolve a day of Athasian travel — water requirements, dehydration, and exhaustion for the whole party including pack beasts — from one macro, with nothing written until they confirm.

**Architecture:** All arithmetic lives in `scripts/core/survival.mjs`, a pure module with no Foundry globals, tested by `node --test`. A thin adapter `scripts/survival.mjs` maps Actors onto plain objects and applies results. A dialog collects the day's conditions, a chat card previews the outcome, and an Apply button commits it. The entry point is a macro in the existing `dark-sun-macros` pack — no render hooks anywhere.

**Tech Stack:** Foundry VTT v13/v14, dnd5e 5.3.x, ES modules, `node --test` (no test framework dependency), YAML pack sources compiled by `tools/build-packs.mjs`.

**Spec:** [`docs/superpowers/specs/2026-08-14-survival-tracking-design.md`](../specs/2026-08-14-survival-tracking-design.md)

## Global Constraints

- **Module id is `dark-sun-essentials`.** Every i18n key is prefixed with it.
- **`scripts/core/*.mjs` must never reference a Foundry global** (`game`, `ui`, `Hooks`, `CONFIG`, `foundry`). `test/i18n.test.mjs` and the test suite import these files directly under plain node.
- **Every `dark-sun-essentials.`-prefixed string in any `.mjs` must exist in `lang/en.json`.** `test/i18n.test.mjs` scans all source files and fails otherwise. Add keys in the same commit as the code referencing them.
- **Never `git add -A` or `git add .`** — `.claude/` is untracked and must stay that way. Stage named files only.
- **Never rsync to the Pi without asking Chris first, and dry-run (`-n`) first.** Deploying overwrites a live module directory and bounces the server.
- **Local tests are a pre-flight check, not proof.** Anything touching Foundry hooks, dnd5e config, the settings UI, or actor writes needs a real load on the Pi before it is called done. Report local and remote results separately.
- **Run `npm run build:packs` before any Pi deploy** — `packs/` is gitignored and a fresh checkout has none.
- **Rules source of truth is `01-survival.md`** in the vault at `Dark Sun/1. CORE/ATHAS-5E/`. Constants are hand-copied literals; the tests assert them against the ruleset's tables as written.
- **Target version for this work is 1.6.0.**

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/core/constants.mjs` | *modify* — add `SETTINGS.survivalTracking` |
| `scripts/core/survival.mjs` | *create* — all survival arithmetic, pure |
| `scripts/survival.mjs` | *create* — Actor ↔ plain-object mapping, applying a plan |
| `scripts/apps/survival-dialog.mjs` | *create* — ApplicationV2 dialog + chat card |
| `scripts/settings.mjs` | *modify* — register `survivalTracking` |
| `scripts/main.mjs` | *modify* — expose `openSurvivalDialog` on the api |
| `lang/en.json` | *modify* — `survival.*` keys |
| `test/survival.test.mjs` | *create* — the whole of `core/survival.mjs` |
| `packs/src/dark-sun-macros/Resolve_Survival_Day_*.yml` | *create* — the entry point |
| `packs/src/dark-sun-journals/Survival_and_Travel_*.yml` | *create* — the text half |
| `module.json` | *modify* — version 1.6.0 |
| `README.md` | *modify* — document the feature |

`core/survival.mjs` is the only file with interesting logic. It is expected to reach roughly 250 lines, comparable to `core/coinage.mjs` at 230 — if it grows past 350, split the supply-reading half into `core/supplies.mjs`.

---

### Task 1: Water requirement arithmetic

**Files:**
- Modify: `scripts/core/constants.mjs`
- Create: `scripts/core/survival.mjs`
- Test: `test/survival.test.mjs`

**Interfaces:**
- Consumes: `MODULE_ID` from `./constants.mjs`
- Produces:
  - `SIZE_WATER_GAL: Readonly<Record<string, number>>` — dnd5e size keys → gal/day
  - `SPECIES_WATER_GAL: Readonly<Record<string, number>>` — species slug → gal/day
  - `THRI_KREEN_WEEKLY_GAL: number`
  - `WATER_MODIFIERS: Readonly<Record<string, number>>`
  - `roundQuarterGal(gal: number): number`
  - `baseWaterGal(creature: Creature): number`
  - `dailyWaterGal(creature: Creature, conditions: DayConditions): number`
  - `Creature = {size: string, species: string|null, isThriKreen: boolean, metalArmor: boolean}`
  - `DayConditions = {pace: "day"|"night"|"inactive", heat: "none"|"hot"|"extreme", shaded: boolean}`

- [ ] **Step 1: Add the setting key**

In `scripts/core/constants.mjs`, add to the `SETTINGS` object:

```js
export const SETTINGS = {
  ceramicCurrency: "ceramicCurrency",
  removeLegacyCurrency: "removeLegacyCurrency",
  psionicSchool: "psionicSchool",
  psionicProperty: "psionicProperty",
  materialProperties: "materialProperties",
  siltVehicles: "siltVehicles",
  survivalTracking: "survivalTracking"
};
```

- [ ] **Step 2: Write the failing tests**

Create `test/survival.test.mjs`:

```js
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
/** A calm, shaded, stationary day — every modifier at rest. */
const MILD = { pace: "inactive", heat: "none", shaded: false };

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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="water|size|kank|thri|round|modifier|heat|metal|night"`

Simpler: `node --test test/survival.test.mjs`

Expected: FAIL — `Cannot find module '../scripts/core/survival.mjs'`

- [ ] **Step 4: Write the implementation**

Create `scripts/core/survival.mjs`:

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/survival.test.mjs`
Expected: PASS, 17 tests

- [ ] **Step 6: Run the whole suite for regressions**

Run: `npm test`
Expected: PASS — in particular `test/i18n.test.mjs`, which scans every source file and would fail on an undefined key. This task adds no i18n keys, so it should be clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/core/survival.mjs scripts/core/constants.mjs test/survival.test.mjs
git commit -m "Price a day's water for anything that drinks

Species rate beats size rate, which is the whole trick: a kank is Large
and a generic Large drinks 4 gallons, but a kank drinks 2. Thri-kreen are
exempt from the quarter-gallon rounding because 1/7 rounds to 0.25 and
would charge them 1.75 gallons a week against a rule that says one."
```

---

### Task 2: Dehydration and rest verdicts

**Files:**
- Modify: `scripts/core/survival.mjs`
- Test: `test/survival.test.mjs`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `MAX_EXHAUSTION: number` (6)
  - `DEHYDRATION_SAVE_DC: number` (15)
  - `dehydrationOutcome({requiredGal, drunkGal, currentExhaustion}): DehydrationOutcome`
  - `DehydrationOutcome = {kind: "none"|"save"|"levels", dc: number|null, levels: number}`
  - `clampExhaustion(current: number, add: number): {final: number, applied: number, lethal: boolean}`
  - `longRestVerdict({ateHalf, drankHalf, hadShelter}): {removesExhaustion: boolean, fullHpRecovery: boolean}`

- [ ] **Step 1: Write the failing tests**

Append to `test/survival.test.mjs`:

```js
import {
  DEHYDRATION_SAVE_DC,
  MAX_EXHAUSTION,
  clampExhaustion,
  dehydrationOutcome,
  longRestVerdict
} from "../scripts/core/survival.mjs";

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
```

Merge the new `import` into the existing one at the top of the file rather than adding a second import from the same module.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/survival.test.mjs`
Expected: FAIL — `dehydrationOutcome is not a function` (or a named-export error)

- [ ] **Step 3: Write the implementation**

Append to `scripts/core/survival.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/survival.test.mjs`
Expected: PASS, 31 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/core/survival.mjs test/survival.test.mjs
git commit -m "Decide what thirst costs, and what a night's rest is worth

The none-at-all branch is checked before the less-than-half branch on
purpose: zero is also less than half, and taking the wrong branch hands a
creature that drank nothing the lighter penalty. Exhaustion clamps at six
and reports what actually landed, because six is death and a GM should see
that before they commit it."
```

---

### Task 3: Reading supplies

**Files:**
- Modify: `scripts/core/survival.mjs`
- Test: `test/survival.test.mjs`

**Interfaces:**
- Consumes: `MODULE_ID` from `./constants.mjs` (add to the existing import)
- Produces:
  - `WATER_ITEM_GAL: Readonly<Record<string, number>>` — item identifier → gallons per unit
  - `WATERSKIN_GAL: number`, `CASK_GAL: number`
  - `CONTAINER_CAP_SKINS: Readonly<Record<string, number>>`
  - `waterGalForItem(item: PlainItem): number` — gallons this stack holds, 0 if not water
  - `totalWaterGal(items: PlainItem[]): number`
  - `containerCapGal(size: string): number|null` — null means weight-limited, not bulk-limited
  - `PlainItem = {identifier: string|null, type: string|null, quantity: number, flagGal: number|null}`

- [ ] **Step 1: Write the failing tests**

Append to `test/survival.test.mjs`:

```js
import {
  CASK_GAL,
  CONTAINER_CAP_SKINS,
  WATERSKIN_GAL,
  WATER_ITEM_GAL,
  containerCapGal,
  totalWaterGal,
  waterGalForItem
} from "../scripts/core/survival.mjs";

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/survival.test.mjs`
Expected: FAIL — `waterGalForItem is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/core/survival.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/survival.test.mjs`
Expected: PASS, 45 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/core/survival.mjs test/survival.test.mjs
git commit -m "Count the water a party is actually carrying

Identified by system.identifier, not by name — names are localised and
GMs rename things. water-1tun is left out of the table on purpose: the
item is recorded at 1 lb, which cannot be a tun, so its volume is unknown
and guessing 250 gallons would hand a party water it does not have."
```

---

### Task 4: Building a day's plan

**Files:**
- Modify: `scripts/core/survival.mjs`
- Test: `test/survival.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–3
- Produces:
  - `buildDayPlan({members, conditions}): DayPlan`
  - `Member = {id: string, name: string, size: string, species: string|null, isThriKreen: boolean, metalArmor: boolean, currentExhaustion: number, drunkGal: number, items: PlainItem[]}`
  - `PlanRow = {id, name, requiredGal, drunkGal, outcome, projected: {final, applied, lethal}, capExceeded: boolean, rest: {removesExhaustion, fullHpRecovery}, saveFailed: boolean}`
  - `DayPlan = {conditions, rows: PlanRow[], totals: {requiredGal, drunkGal, supplyGal, daysOfSupply: number|null}}`
  - `DayConditions` gains two fields here: `sheltered: boolean` and `ateHalf: boolean`. Shade and shelter are different things — shade halves water, shelter is what a long rest needs — so they are separate flags.

This is the keystone: the dialog produces its input, the chat card renders it, and Apply consumes it. It stays pure so the whole day can be tested without a game.

- [ ] **Step 1: Write the failing tests**

Append to `test/survival.test.mjs`:

```js
import { buildDayPlan } from "../scripts/core/survival.mjs";

/** The party from the cheat sheet, minus the bookkeeping. */
function member(name, overrides = {}) {
  return {
    id: name.toLowerCase(),
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
      member("Itilda", { items: [{ identifier: "waterskin", type: "drink", quantity: 12, flagGal: null }] }),
      member("Kank #1", {
        size: "lg", species: "kank",
        items: [{ identifier: "cask", type: "drink", quantity: 4, flagGal: null }]
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
      items: [{ identifier: "water-gallon", type: "drink", quantity: 5, flagGal: null }]
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
      items: [{ identifier: "waterskin", type: "drink", quantity: 20, flagGal: null }]
    })],
    conditions: DAY_MARCH
  });
  assert.equal(plan.rows[0].capExceeded, true, "10 gal on a 6 gal frame");
});

test("a beast carrying casks is never flagged, being weight-limited", () => {
  const plan = buildDayPlan({
    members: [member("Kank #1", {
      size: "lg", species: "kank",
      items: [{ identifier: "cask", type: "drink", quantity: 30, flagGal: null }]
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
    members: [member("Kaine", { drunkGal: 0.5 })],
    conditions: CAMPED
  });
  assert.equal(plan.rows[0].rest.removesExhaustion, false, "2 gal needed, 0.5 drunk");
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/survival.test.mjs`
Expected: FAIL — `buildDayPlan is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/core/survival.mjs`:

```js
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
    const requiredGal = dailyWaterGal(m, conditions);

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
      name: m.name,
      requiredGal,
      drunkGal,
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/survival.test.mjs`
Expected: PASS, every test in the file

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, all files

- [ ] **Step 6: Commit**

```bash
git add scripts/core/survival.mjs test/survival.test.mjs
git commit -m "Resolve a whole day into one reviewable plan

The plan object is what Apply consumes, rather than recomputing, so a
setting changed between preview and commit cannot alter what a GM already
approved. Days of supply floors rather than rounds: two and a half days
of water is two days a party can count on."
```

---

### Task 5: The setting and its copy

**Files:**
- Modify: `scripts/settings.mjs`
- Modify: `lang/en.json`
- Test: `test/config.test.mjs` (verify it still passes), `test/i18n.test.mjs`

**Interfaces:**
- Consumes: `SETTINGS.survivalTracking` from Task 1
- Produces: a registered world setting, `survivalTracking`, default `false`

- [ ] **Step 1: Add the i18n keys**

In `lang/en.json`, add after the `siltVehicles` hint:

```json
  "dark-sun-essentials.settings.survivalTracking.name": "Survival Tracking",
  "dark-sun-essentials.settings.survivalTracking.hint": "Adds a macro that resolves a day of desert travel: water requirements, dehydration and exhaustion for the whole party, pack beasts included. Nothing is written to a sheet until you confirm it.",

  "dark-sun-essentials.survival.dialogTitle": "Resolve Survival Day",
  "dark-sun-essentials.survival.pace": "Travel Pace",
  "dark-sun-essentials.survival.paceDay": "Day march",
  "dark-sun-essentials.survival.paceNight": "Night march",
  "dark-sun-essentials.survival.paceInactive": "Inactive — camped or holed up",
  "dark-sun-essentials.survival.heat": "Heat",
  "dark-sun-essentials.survival.heatNone": "Bearable",
  "dark-sun-essentials.survival.heatHot": "Above 100 °F",
  "dark-sun-essentials.survival.heatExtreme": "Above 130 °F",
  "dark-sun-essentials.survival.shaded": "Under shade all day",
  "dark-sun-essentials.survival.shadedHint": "Halves water. A sun cloak over the day camp counts.",
  "dark-sun-essentials.survival.sheltered": "Sheltered for the night",
  "dark-sun-essentials.survival.shelteredHint": "A cave, a ruin, an oasis. Required to remove exhaustion on a long rest, and to regain hit points normally.",
  "dark-sun-essentials.survival.ateHalf": "At least half rations eaten",
  "dark-sun-essentials.survival.metalArmor": "Wearing metal armour",
  "dark-sun-essentials.survival.drunk": "Gallons drunk",
  "dark-sun-essentials.survival.resolve": "Resolve",
  "dark-sun-essentials.survival.cancel": "Cancel",
  "dark-sun-essentials.survival.apply": "Apply",
  "dark-sun-essentials.survival.cardTitle": "A Day in the Wastes",
  "dark-sun-essentials.survival.colMember": "Creature",
  "dark-sun-essentials.survival.colNeeded": "Needed",
  "dark-sun-essentials.survival.colDrunk": "Drunk",
  "dark-sun-essentials.survival.colResult": "Result",
  "dark-sun-essentials.survival.resultFine": "—",
  "dark-sun-essentials.survival.resultSave": "DC {dc} CON save or {levels} exhaustion",
  "dark-sun-essentials.survival.resultLevels": "{levels} exhaustion, no save",
  "dark-sun-essentials.survival.resultDeath": "DEATH — exhaustion 6",
  "dark-sun-essentials.survival.saveFailed": "Failed",
  "dark-sun-essentials.survival.savesPending": "Tick anyone who failed their save, then apply. Untick means they made it.",
  "dark-sun-essentials.survival.restYes": "A long rest tonight removes a level of exhaustion.",
  "dark-sun-essentials.survival.restNo": "A long rest tonight removes no exhaustion.",
  "dark-sun-essentials.survival.restNoHp": "Without shelter, hit points come back only from Hit Dice.",
  "dark-sun-essentials.survival.assumedMedium": "{name} has no size recorded and was treated as Medium.",
  "dark-sun-essentials.survival.capExceeded": "{name} is carrying more water than a creature that size can physically hold.",
  "dark-sun-essentials.survival.supplyUnknown": "No water items found. Requirements are shown, but nothing will be deducted.",
  "dark-sun-essentials.survival.supply": "Supply after today: {gallons} gal — {days} days",
  "dark-sun-essentials.survival.supplyNoDays": "Supply after today: {gallons} gal",
  "dark-sun-essentials.survival.applied": "Applied a day of travel to {count} creatures.",
  "dark-sun-essentials.notify.survivalDisabled": "Survival tracking is switched off. Enable it in the Dark Sun Essentials settings.",
  "dark-sun-essentials.notify.survivalGmOnly": "Only the GM can resolve a survival day.",
  "dark-sun-essentials.notify.noParty": "No party found. Set a primary party in the Actors sidebar, or select the tokens you want to resolve.",
```

Every key here is used by Tasks 6–9. `test/i18n.test.mjs` also fails on keys defined but never referenced, so **if that test reports unused keys at the end of Task 9, delete the unused ones rather than inventing a use for them.**

- [ ] **Step 2: Register the setting**

In `scripts/settings.mjs`, add after the `siltVehicles` registration and before `log("debug", ...)`:

```js
  // The only setting here that does not require a reload. Every other toggle
  // does because dnd5e builds its data model schemas from CONFIG on first
  // document access, so a mid-session change would exist in the config table
  // and in no actor's schema. This one mutates no config — it gates a macro —
  // so the reason does not apply and neither does the requirement.
  game.settings.register(MODULE_ID, SETTINGS.survivalTracking, {
    name: `${MODULE_ID}.settings.survivalTracking.name`,
    hint: `${MODULE_ID}.settings.survivalTracking.hint`,
    scope: "world",
    config: true,
    requiresReload: false,
    type: Boolean,
    default: false
  });
```

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS. `test/i18n.test.mjs` may report the new `survival.*` keys as unreferenced — if it fails for that reason, note it and proceed; Tasks 6–9 add the references. If it fails for any other reason, stop and fix.

- [ ] **Step 4: Commit**

```bash
git add scripts/settings.mjs lang/en.json
git commit -m "Give survival tracking a switch and its words

The one toggle in this file that does not require a reload, with the
reason written next to it: the others exist because dnd5e freezes its
schemas from CONFIG at first document access, and this one touches no
config at all."
```

---

### Task 6: Reading the party

**Files:**
- Create: `scripts/survival.mjs`

**Interfaces:**
- Consumes: `MODULE_ID`, `SETTINGS` from `./core/constants.mjs`; `setting` from `./settings.mjs`; `log` from `./compat.mjs`
- Produces:
  - `resolveParty(): Actor[]|null` — party members, or the current selection, or null
  - `actorToMember(actor): Member` — the plain object `buildDayPlan` expects
  - `readItems(actor): PlainItem[]`
  - `hasMetalArmor(actor): boolean`

**This task cannot be verified locally.** It reads Foundry documents. Local `npm test` proves only that the file parses and that `test/i18n.test.mjs` still passes.

- [ ] **Step 1: Write the module**

Create `scripts/survival.mjs`:

```js
/**
 * Survival tracking — the half that knows what an Actor is.
 *
 * Everything here reads or writes Foundry documents, which is why none of it
 * lives in `core/survival.mjs` and why none of it is covered by `npm test`.
 * The arithmetic is over there and is tested; this file's job is to map
 * Actors onto the plain objects that module expects, and to apply what comes
 * back.
 */

import { MODULE_ID, SETTINGS } from "./core/constants.mjs";
import { log } from "./compat.mjs";
import { setting } from "./settings.mjs";
import { buildDayPlan, clampExhaustion } from "./core/survival.mjs";

/**
 * The creatures this day applies to.
 *
 * Prefers the world's primary party, because it survives scene changes and a
 * GM already maintains it. Falls back to the current token selection, which is
 * explicit but forgettable. Returns null rather than guessing when there is
 * neither — a survival day resolved against the wrong creatures is worse than
 * one not resolved at all.
 *
 * @returns {Actor[]|null}
 */
export function resolveParty() {
  const party = game.actors?.party;
  const members = party?.system?.members ?? [];

  if ( members.length ) {
    // dnd5e models group membership as records wrapping an actor reference.
    // Tolerate both that and a bare actor, since the shape has moved between
    // system versions.
    return members.map(m => m.actor ?? m).filter(Boolean);
  }

  const selected = canvas?.tokens?.controlled?.map(t => t.actor).filter(Boolean) ?? [];
  if ( selected.length ) {
    log("debug", `No primary party set; falling back to ${selected.length} selected tokens.`);
    return selected;
  }

  return null;
}

/**
 * Does this actor wear metal armour?
 *
 * Reads the Metal material property this module adds when `materialProperties`
 * is on. When that toggle is off the property does not exist, so the answer is
 * always false here and the dialog asks the GM instead. The module must not
 * assume its own optional features are enabled.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasMetalArmor(actor) {
  if ( !setting(SETTINGS.materialProperties) ) return false;

  return actor.items?.some(item =>
    item.type === "equipment"
    && item.system?.equipped
    && item.system?.properties?.has?.("metal")
  ) ?? false;
}

/**
 * Flatten an actor's inventory into the shape `core/survival.mjs` reads.
 * @param {Actor} actor
 * @returns {Array<{identifier: string|null, type: string|null, quantity: number, flagGal: number|null}>}
 */
export function readItems(actor) {
  return (actor.items ?? []).map(item => ({
    identifier: item.system?.identifier ?? null,
    type: item.system?.type?.value ?? null,
    quantity: item.system?.quantity ?? 0,
    flagGal: item.getFlag?.(MODULE_ID, "survival.waterGal") ?? null
  }));
}

/**
 * Map one Actor onto a plain member object.
 *
 * `species` is taken from the race item's identifier, which is what pack
 * beasts in the creature catalog carry. `assumedMedium` rides along so the
 * chat card can say out loud that it guessed.
 *
 * @param {Actor} actor
 * @returns {object}
 */
export function actorToMember(actor) {
  const size = actor.system?.traits?.size ?? null;
  const race = actor.system?.details?.race;
  const species = (typeof race === "string" ? race : race?.identifier ?? race?.name)
    ?.toLowerCase?.() ?? null;

  return {
    id: actor.id,
    name: actor.name,
    size: size ?? "med",
    assumedMedium: !size,
    species,
    isThriKreen: species === "thri-kreen" || species === "thrikreen",
    metalArmor: hasMetalArmor(actor),
    currentExhaustion: actor.system?.attributes?.exhaustion ?? 0,
    drunkGal: null,
    items: readItems(actor)
  };
}

/**
 * Build a plan for the given actors under the given conditions.
 * @param {Actor[]} actors
 * @param {object} conditions
 * @param {Record<string, number|null>} [intake]  Actor id → gallons drunk.
 * @returns {object}
 */
export function planForActors(actors, conditions, intake = {}) {
  const members = actors.map(actor => {
    const member = actorToMember(actor);
    if ( actor.id in intake ) member.drunkGal = intake[actor.id];
    return member;
  });

  const plan = buildDayPlan({ members, conditions });

  // Carry the warnings the arithmetic layer has no way to know about.
  plan.warnings = members.filter(m => m.assumedMedium).map(m => m.name);
  return plan;
}
```

- [ ] **Step 2: Verify it parses and the suite is clean**

Run: `node --input-type=module -e "import('./scripts/survival.mjs').catch(e => { if (!/game is not defined|Cannot use import/.test(e.message)) throw e; })"`

Simpler and sufficient: `npm test`
Expected: PASS. The i18n test walks this file; it references no `dark-sun-essentials.`-prefixed strings except via `MODULE_ID` in `getFlag`, which is not a localization key.

- [ ] **Step 3: Commit**

```bash
git add scripts/survival.mjs
git commit -m "Map Athasian actors onto something the arithmetic can read

Prefers the primary party and falls back to selected tokens, but returns
null rather than guessing — a day resolved against the wrong creatures is
worse than one not resolved. Metal armour comes from this module's own
material property, and is answered false when that toggle is off rather
than assumed."
```

---

### Task 7: Applying a plan

**Files:**
- Modify: `scripts/survival.mjs`

**Interfaces:**
- Consumes: the `DayPlan` from Task 4, actors from Task 6
- Produces: `applyPlan(plan): Promise<{applied: number, failed: string[]}>`

**Cannot be verified locally.** This writes to actors.

- [ ] **Step 1: Write the implementation**

Append to `scripts/survival.mjs`:

```js
/* -------------------------------------------- */
/*  Applying                                     */
/* -------------------------------------------- */

/**
 * Commit a plan the GM has approved.
 *
 * Reads the stored plan rather than recomputing, so what lands is what was on
 * the card. Rows whose outcome was a save are applied only if the caller has
 * already marked them failed — `row.saveFailed` — because this module does not
 * roll for a player.
 *
 * Failures are collected rather than thrown: one actor a GM lacks permission
 * to update should not abandon the other six mid-write.
 *
 * @param {object} plan
 * @returns {Promise<{applied: number, failed: string[]}>}
 */
export async function applyPlan(plan) {
  const failed = [];
  let applied = 0;

  for ( const row of plan.rows ) {
    const owed = row.outcome.kind === "save" ? (row.saveFailed ? row.outcome.levels : 0)
      : row.outcome.levels;
    if ( !owed ) continue;

    const actor = game.actors?.get(row.id);
    if ( !actor ) {
      failed.push(row.name);
      continue;
    }

    // Recompute the clamp against the actor's exhaustion as it stands now,
    // not as it stood when the card was posted. A GM who healed someone
    // between preview and Apply should not have that undone.
    const { final } = clampExhaustion(actor.system?.attributes?.exhaustion ?? 0, owed);

    try {
      await actor.update({ "system.attributes.exhaustion": final });
      applied += 1;
    } catch ( error ) {
      log("error", `Could not apply exhaustion to ${row.name}: ${error.message}`);
      failed.push(row.name);
    }
  }

  return { applied, failed };
}
```

Note the deliberate asymmetry with Task 4: `buildDayPlan` clamps against the exhaustion captured at preview time so the card shows a stable projection, and `applyPlan` re-clamps against live state so the write is correct. Both are right for their moment.

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/survival.mjs
git commit -m "Write the day the GM approved, and only that

Re-clamps against each actor's exhaustion as it stands at Apply rather
than as it stood at preview, so a GM who healed someone in between does
not have it undone. Failures are collected, not thrown: one actor without
permission should not abandon the rest mid-write."
```

---

### Task 8: The dialog

**Files:**
- Create: `scripts/apps/survival-dialog.mjs`
- Modify: `scripts/main.mjs`

**Interfaces:**
- Consumes: `resolveParty`, `planForActors` from `../survival.mjs`
- Produces: `openSurvivalDialog(): Promise<void>`

**Cannot be verified locally.** This needs a running Foundry.

Note the repo uses **`DialogV2`**, not a hand-rolled ApplicationV2 subclass — see `scripts/apps/migration-dialog.mjs`. Match that: `DialogV2.wait`, an HTML string for content, a `callback` on the confirming button that reads the form through `FormDataExtended`.

- [ ] **Step 1: Write the dialog**

Create `scripts/apps/survival-dialog.mjs`:

```js
/**
 * The survival day: ask what kind of day it was, then show what it cost.
 *
 * DialogV2, matching the migration dialog — available in both v13 and v14.
 * Nothing here computes anything; the arithmetic is in `core/survival.mjs` and
 * the actor reading is in `survival.mjs`. This file collects inputs and hands
 * the result to a chat card the GM still has to approve.
 */

import { MODULE_ID, SETTINGS } from "../core/constants.mjs";
import { setting } from "../settings.mjs";
import { log } from "../compat.mjs";
import { planForActors, resolveParty } from "../survival.mjs";

const { DialogV2 } = foundry.applications.api;

/** v13 namespaced it; the bare global is deprecated but still present. */
const FormDataExtended = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;

/** Escape untrusted text for interpolation into the dialog's HTML. */
const esc = value => foundry.utils.escapeHTML?.(String(value)) ?? String(value);

/**
 * Open the survival dialog and, if the GM confirms, post the plan.
 * @returns {Promise<void>}
 */
export async function openSurvivalDialog() {
  // Also the module's public API, so a player calling it from the console
  // must not get a dialog full of other people's exhaustion totals.
  if ( !game.user?.isGM ) {
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.notify.survivalGmOnly`));
    return;
  }

  if ( !setting(SETTINGS.survivalTracking) ) {
    ui.notifications?.warn(game.i18n.localize(`${MODULE_ID}.notify.survivalDisabled`));
    return;
  }

  const actors = resolveParty();
  if ( !actors?.length ) {
    ui.notifications?.warn(game.i18n.localize(`${MODULE_ID}.notify.noParty`));
    return;
  }

  // The armour question is only asked when the module cannot answer it. With
  // material properties on, it is read off the equipped armour instead.
  const askArmour = !setting(SETTINGS.materialProperties);

  const result = await DialogV2.wait({
    window: { title: `${MODULE_ID}.survival.dialogTitle`, icon: "fa-solid fa-sun" },
    position: { width: 460 },
    content: buildContent(actors, askArmour),
    buttons: [
      {
        action: "resolve",
        icon: "fa-solid fa-droplet",
        label: `${MODULE_ID}.survival.resolve`,
        default: true,
        callback: (event, button) => readForm(button.form, actors, askArmour)
      },
      {
        action: "cancel",
        icon: "fa-solid fa-xmark",
        label: `${MODULE_ID}.survival.cancel`
      }
    ],
    rejectClose: false,
    modal: true
  });

  // `cancel`, the close button, and Escape all land here.
  if ( !result || typeof result !== "object" ) {
    log("info", "Survival day declined.");
    return;
  }

  const plan = planForActors(actors, result.conditions, result.intake, result.armour);
  await postPlanCard(plan);
}

/* -------------------------------------------- */

/**
 * @param {Actor[]} actors
 * @param {boolean} askArmour
 * @returns {string}
 */
function buildContent(actors, askArmour) {
  const t = key => game.i18n.localize(`${MODULE_ID}.survival.${key}`);

  const radios = (name, options) => options.map(([value, key], index) => `<label>
    <input type="radio" name="${name}" value="${value}"${index === 0 ? " checked" : ""}>
    <span>${t(key)}</span>
  </label>`).join("");

  const rows = actors.map(actor => `<div class="dark-sun-survival-row">
    <span class="name">${esc(actor.name)}</span>
    <input type="number" name="drunk.${actor.id}" min="0" step="0.25"
           placeholder="${t("drunk")}">
    ${askArmour ? `<label class="armour">
      <input type="checkbox" name="metal.${actor.id}">
      <span>${t("metalArmor")}</span>
    </label>` : ""}
  </div>`).join("");

  return `
    <fieldset><legend>${t("pace")}</legend>
      ${radios("pace", [["day", "paceDay"], ["night", "paceNight"], ["inactive", "paceInactive"]])}
    </fieldset>
    <fieldset><legend>${t("heat")}</legend>
      ${radios("heat", [["none", "heatNone"], ["hot", "heatHot"], ["extreme", "heatExtreme"]])}
    </fieldset>
    <fieldset>
      <label><input type="checkbox" name="shaded"> <span>${t("shaded")}</span></label>
      <p class="notes">${t("shadedHint")}</p>
      <label><input type="checkbox" name="sheltered"> <span>${t("sheltered")}</span></label>
      <p class="notes">${t("shelteredHint")}</p>
      <label><input type="checkbox" name="ateHalf" checked> <span>${t("ateHalf")}</span></label>
    </fieldset>
    <div class="dark-sun-survival-members">${rows}</div>
  `;
}

/* -------------------------------------------- */

/**
 * Read the dialog back into the shapes `planForActors` expects.
 *
 * A blank intake stays null rather than becoming 0 — null means "drank their
 * fill", 0 means "drank nothing", and the two carry very different penalties.
 *
 * @param {HTMLFormElement} form
 * @param {Actor[]} actors
 * @param {boolean} askArmour
 * @returns {{conditions: object, intake: object, armour: object}}
 */
function readForm(form, actors, askArmour) {
  const data = new FormDataExtended(form).object;
  const intake = {};
  const armour = {};

  for ( const actor of actors ) {
    const raw = data[`drunk.${actor.id}`];
    const blank = (raw === "" || raw === null || raw === undefined);
    intake[actor.id] = blank ? null : Math.max(0, Number(raw) || 0);
    if ( askArmour ) armour[actor.id] = data[`metal.${actor.id}`] === true;
  }

  return {
    conditions: {
      pace: data.pace ?? "day",
      heat: data.heat ?? "none",
      shaded: data.shaded === true,
      sheltered: data.sheltered === true,
      ateHalf: data.ateHalf === true
    },
    intake,
    armour
  };
}
```

- [ ] **Step 2: Let the adapter accept the armour answers**

`planForActors` in `scripts/survival.mjs` (Task 6) takes three arguments. Widen it to four so the dialog's answers reach the member objects. Replace its signature and body with:

```js
export function planForActors(actors, conditions, intake = {}, armour = {}) {
  const members = actors.map(actor => {
    const member = actorToMember(actor);
    if ( actor.id in intake ) member.drunkGal = intake[actor.id];
    // The GM's answer wins when the module had to ask. When material
    // properties are on it never asks, and `armour` arrives empty.
    if ( actor.id in armour ) member.metalArmor = armour[actor.id];
    return member;
  });

  const plan = buildDayPlan({ members, conditions });
  plan.warnings = members.filter(m => m.assumedMedium).map(m => m.name);
  return plan;
}
```

- [ ] **Step 3: Wire it into the api**

In `scripts/main.mjs`, add the import and extend the api object:

```js
import { openSurvivalDialog } from "./apps/survival-dialog.mjs";
```

```js
  if ( module ) module.api = {
    scanWorld, summarise, applyMigration, runMigration, openMigrationDialog,
    openSurvivalDialog
  };
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS — `test/i18n.test.mjs` now finds references for the `survival.*` dialog keys added in Task 5.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/survival-dialog.mjs scripts/main.mjs
git commit -m "Ask the GM what kind of day it was

Blank intake means the creature drank its fill, which is the common case
and should not need typing. The metal armour checkboxes appear only when
the material properties toggle is off — when it is on the answer is read
from the armour itself."
```

---

### Task 9: The chat card and Apply

**Files:**
- Modify: `scripts/apps/survival-dialog.mjs`
- Modify: `scripts/main.mjs`

**Interfaces:**
- Consumes: the `DayPlan`, `applyPlan` from Task 7
- Produces: `postPlanCard(plan): Promise<ChatMessage>`, and a click handler for the Apply button

**Cannot be verified locally.** Chat message rendering and button binding changed between Foundry v12 and v13 (`renderChatMessage` became `renderChatMessageHTML`). **Confirm which hook fires on the Pi's v14 before calling this done** — this is the single most version-fragile piece of the feature.

- [ ] **Step 1: Write the card**

Append to `scripts/apps/survival-dialog.mjs`:

```js
/* -------------------------------------------- */
/*  The card                                     */
/* -------------------------------------------- */

/** Two decimals, but only when they earn their place. A thri-kreen needs them. */
const gal = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/**
 * Post the plan for the GM to approve.
 *
 * The whole plan rides along in a message flag, and Apply reads it back rather
 * than recomputing — so what lands is what was on the card even if a setting
 * changed in between.
 *
 * @param {object} plan
 * @returns {Promise<ChatMessage>}
 */
export async function postPlanCard(plan) {
  const t = (key, data) => (data
    ? game.i18n.format(`${MODULE_ID}.survival.${key}`, data)
    : game.i18n.localize(`${MODULE_ID}.survival.${key}`));

  const rows = plan.rows.map(row => {
    // Death is shown instead of the save prompt, never behind it. Exhaustion
    // 6 is lethal under the 2024 rules and a GM should not have to read a DC
    // to notice they are about to kill someone.
    let result;
    if ( row.projected.lethal ) result = `<strong class="dse-lethal">${t("resultDeath")}</strong>`;
    else if ( row.outcome.kind === "save" ) result = t("resultSave", row.outcome);
    else if ( row.outcome.kind === "levels" ) result = t("resultLevels", row.outcome);
    else result = t("resultFine");

    // Only rows that owe a save get a checkbox. Everything else is decided.
    const tick = row.outcome.kind === "save"
      ? `<label><input type="checkbox" data-dse-save="${row.id}"> ${t("saveFailed")}</label>`
      : "";

    return `<tr>
      <td>${esc(row.name)}</td>
      <td>${gal(row.requiredGal)}</td>
      <td>${gal(row.drunkGal)}</td>
      <td>${result} ${tick}</td>
    </tr>`;
  }).join("");

  const notes = [];
  if ( plan.rows.some(r => r.outcome.kind === "save") ) notes.push(t("savesPending"));

  if ( !plan.totals.supplyGal ) notes.push(t("supplyUnknown"));
  else if ( plan.totals.daysOfSupply === null ) {
    notes.push(t("supplyNoDays", { gallons: gal(plan.totals.supplyGal) }));
  } else {
    notes.push(t("supply", {
      gallons: gal(plan.totals.supplyGal),
      days: plan.totals.daysOfSupply
    }));
  }

  // Rest is reported per member, but says the same thing for everyone unless
  // someone drank short. Report the exceptions rather than a wall of rows.
  if ( plan.rows.length && plan.rows.every(r => r.rest.removesExhaustion) ) notes.push(t("restYes"));
  else if ( plan.rows.length ) notes.push(t("restNo"));
  if ( plan.rows.some(r => !r.rest.fullHpRecovery) ) notes.push(t("restNoHp"));

  for ( const name of plan.warnings ?? [] ) notes.push(t("assumedMedium", { name: esc(name) }));
  for ( const row of plan.rows.filter(r => r.capExceeded) ) {
    notes.push(t("capExceeded", { name: esc(row.name) }));
  }

  const content = `<div class="dark-sun-survival-card">
    <h3>${t("cardTitle")}</h3>
    <table><thead><tr>
      <th>${t("colMember")}</th><th>${t("colNeeded")}</th>
      <th>${t("colDrunk")}</th><th>${t("colResult")}</th>
    </tr></thead><tbody>${rows}</tbody></table>
    ${notes.map(n => `<p class="notes">${n}</p>`).join("")}
    <button type="button" data-action="dse-apply-survival">${t("apply")}</button>
  </div>`;

  return ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    flags: { [MODULE_ID]: { survivalPlan: plan } }
  });
}
```

- [ ] **Step 2: Bind the button**

Add to `scripts/apps/survival-dialog.mjs`:

```js
/**
 * Apply a card's plan, taking the failed-save ticks from the card itself.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} button
 */
export async function onApplySurvival(message, button) {
  if ( !game.user?.isGM ) {
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.notify.survivalGmOnly`));
    return;
  }

  const plan = message.getFlag(MODULE_ID, "survivalPlan");
  if ( !plan ) return;

  const card = button.closest(".dark-sun-survival-card");
  for ( const row of plan.rows ) {
    const tick = card?.querySelector(`[data-dse-save="${row.id}"]`);
    row.saveFailed = tick?.checked === true;
  }

  // Disabled before the writes, not after: a double-click during a slow
  // update would otherwise apply the day twice.
  button.disabled = true;

  const { applied, failed } = await applyPlan(plan);
  ui.notifications?.info(game.i18n.format(`${MODULE_ID}.survival.applied`, { count: applied }));
  if ( failed.length ) {
    ui.notifications?.error(game.i18n.format(`${MODULE_ID}.notify.migrationPartial`, {
      count: failed.length
    }), { permanent: true });
  }
}
```

Add `applyPlan` to the existing import from `../survival.mjs` at the top of the file.

In `scripts/main.mjs`, inside the existing `Hooks.once("ready", ...)` **before** the GM early-return (players see the card only if a GM whispers it to them, but the hook must be registered either way), add:

```js
  // v13 renamed the hook and changed the payload from jQuery to a bare
  // element. Both are bound so one build works on v13 and v14; which one
  // actually fires is a question only a real load can answer.
  const bindCard = (message, element) => {
    const html = element instanceof HTMLElement ? element : element?.[0];
    const button = html?.querySelector?.('[data-action="dse-apply-survival"]');
    if ( button ) button.addEventListener("click", () => onApplySurvival(message, button));
  };
  Hooks.on("renderChatMessageHTML", bindCard);
  Hooks.on("renderChatMessage", bindCard);
```

and extend the import to `import { onApplySurvival, openSurvivalDialog } from "./apps/survival-dialog.mjs";`

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS. If `test/i18n.test.mjs` reports any `survival.*` key from Task 5 as unreferenced, **delete that key** — do not invent a use for it.

- [ ] **Step 4: Commit**

```bash
git add scripts/apps/survival-dialog.mjs scripts/main.mjs
git commit -m "Show the day before it happens, and let the GM refuse it

Death is rendered instead of the save prompt, never behind it: exhaustion
6 is lethal under the 2024 rules and a GM should not have to read a DC to
notice. Both chat render hooks are bound so one build works on v13 and
v14; which one actually fires is a question only the Pi can answer."
```

---

### Task 10: The macro

**Files:**
- Create: `packs/src/dark-sun-macros/Resolve_Survival_Day_dseSurvivalDay1.yml`

**Interfaces:**
- Consumes: `module.api.openSurvivalDialog` from Task 8

- [ ] **Step 1: Write the macro source**

Create the file, matching `Convert to Athasian Coinage` exactly in shape:

```yaml
_id: dseSurvivalDay1
name: Resolve Survival Day
type: script
scope: global
author: null
img: icons/consumables/drinks/water-jug-clay-tan.webp
command: |
  // Dark Sun Essentials — resolve one day of Athasian travel.
  //
  // Asks what kind of day it was, works out what every creature in the party
  // needed to drink, and shows you what happens to anyone who came up short.
  // Nothing is written to a sheet until you press Apply.
  const module = game.modules.get("dark-sun-essentials");
  if ( !module?.active ) {
    ui.notifications.error("Dark Sun Essentials is not active in this world.");
  } else {
    await module.api.openSurvivalDialog();
  }
folder: null
sort: 100000
ownership:
  default: 0
flags: {}
_key: '!macros!dseSurvivalDay1'
```

Verify `icons/consumables/drinks/water-jug-clay-tan.webp` exists in the Foundry core icon set on the Pi; if it does not, substitute one that does rather than shipping a broken image.

- [ ] **Step 2: Build the packs**

Run: `npm run build:packs`
Expected: no errors; `packs/dark-sun-macros` now contains two macros.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packs/src/dark-sun-macros/Resolve_Survival_Day_dseSurvivalDay1.yml
git commit -m "Ship the survival day as a macro, not a button

Same shim as the coinage conversion: all logic stays in the module, so a
macro dragged into a world in 1.6 picks up 1.7's fixes. A scene control
would mean render hooks, which are the most version-fragile code here."
```

---

### Task 11: The journal

**Files:**
- Create: `packs/src/dark-sun-journals/Survival_and_Travel_dseSurvivalJrnl1.yml`

**Source:** `Dark Sun/1. CORE/ATHAS-5E/01-survival.md` in the vault. Original prose, safe to distribute. **`00-decisions.md` must not be included** — it names fan authors and cites their page numbers.

- [ ] **Step 1: Read the source and the schema**

Read the ruleset:
`cat "/Users/christopherallbritton/Documents/DnD5e/06-Campaign-Resources/3. Dark Sun/1. CORE/ATHAS-5E/01-survival.md"`

Read an existing journal for the exact schema, including the `_key` forms:
`cat packs/src/dark-sun-journals/A_desert_primer_4AYwZ2eVbrmzXNPY.yml`

- [ ] **Step 2: Write the journal**

One JournalEntry, `_key: '!journal!dseSurvivalJrnl1'`, with one page per section of the ruleset:

1. The Exhaustion Track
2. Heat and the Sun
3. Water — daily need, dehydration, carrying water
4. Food
5. Foraging and Finding Water
6. Travel Pace, including travelling by night
7. Navigation
8. Weather Hazards
9. Pack Beasts and Containers
10. Resting

Convert the markdown to the HTML the schema expects: `##` becomes `<h2>`, tables become `<table>`, blockquotes become `<blockquote>`. Each page needs its own `_id` and a `_key` of the form `'!journal.pages!dseSurvivalJrnl1.<pageId>'`.

Set `ownership: {default: 0}` on the entry — players read these rules. Do not copy the per-user ownership ids from `A_desert_primer`; those are one world's user ids and mean nothing in anyone else's.

- [ ] **Step 3: Build and check**

Run: `npm run build:packs`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packs/src/dark-sun-journals/Survival_and_Travel_dseSurvivalJrnl1.yml
git commit -m "Ship the survival rules the module does not automate

Food, foraging, forced march, navigation and weather are rules a table
reads rather than rules a module runs. Sourced from the Athas 5e slice 1
ruleset; the decisions document that cites its sources stays in the vault."
```

---

### Task 12: Manifest, docs, and the honest report

**Files:**
- Modify: `module.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Bump the version**

In `module.json`, change `"version": "1.5.0"` to `"version": "1.6.0"`.

No new pack entry is needed: the macro goes into the existing `dark-sun-macros` and the journal into the existing `dark-sun-journals`.

- [ ] **Step 2: Run the manifest test**

Run: `node --test test/manifest.test.mjs`
Expected: PASS

- [ ] **Step 3: Document the feature**

In `README.md`, add a Survival Tracking section covering: what the toggle does, that the entry point is the *Resolve Survival Day* macro, that nothing is written until Apply, that pack beasts are handled as party members, and that food/foraging/forced march are journal text rather than automation.

- [ ] **Step 4: Record what is not yet verified**

In `CLAUDE.md`, under "What counts as tested", add:

```markdown
- Survival tracking splits the same way: `core/survival.mjs` is pure and fully
  covered by `npm test`; `scripts/survival.mjs`, the dialog and the chat card
  are not covered at all and need a real load on the Pi. The chat card's Apply
  button is the fragile part — `renderChatMessage` became
  `renderChatMessageHTML` in v13 and both are bound defensively.
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, every file.

- [ ] **Step 6: Commit**

```bash
git add module.json README.md CLAUDE.md
git commit -m "1.6.0: resolve a day in the wastes

Records in CLAUDE.md which half of this feature the local suite actually
covers, and which half is still unproven until it loads on the Pi."
```

- [ ] **Step 7: Report, separately**

State plainly:
- **Locally verified:** every test in `test/survival.test.mjs`, plus the existing suite, plus `npm run build:packs` compiling both new pack sources.
- **Not verified anywhere:** the dialog, the chat card, the Apply button, actor exhaustion writes, party Group reading, and metal-armour detection.

Then **stop**. Do not rsync. Ask Chris whether to deploy, and dry-run with `-n` first when he says yes.

---

## Verification Checklist

Before calling the whole plan done:

- [ ] `npm test` passes, all files
- [ ] `npm run build:packs` completes without error
- [ ] `test/i18n.test.mjs` reports no unreferenced `survival.*` keys
- [ ] `scripts/core/survival.mjs` contains no reference to `game`, `ui`, `Hooks`, `CONFIG`, or `foundry`
- [ ] `.claude/` is still untracked
- [ ] Nothing has been rsynced to the Pi without Chris's explicit say-so

## Follow-ups, not in this plan

- The thri-kreen rounding exemption needs a decision ID in the vault's `00-decisions.md`. It is a new adjudication and slice 1's standard is that every rule traces to one.
- `water_model.py` prices Small creatures at 1.0 gal; the ruleset says 0.5. Vault-side fix.
- `Rations (15 days)` is weight 0 in `dark-sun-items`. Harmless while food is unautomated, misleading afterwards.
- `Water (1 tun)` is weight 1 lb and has no believable volume. Needs a ruling before it can enter `WATER_ITEM_GAL`.
