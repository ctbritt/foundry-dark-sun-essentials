import test from "node:test";
import assert from "node:assert/strict";

import {
  MATERIAL_KEYS,
  MATERIAL_PROPERTIES,
  buildItemProperties,
  buildValidProperties
} from "../scripts/core/materials.mjs";
import { PSIONIC_KEY, PSIONIC_SCHOOL, buildSpellSchools } from "../scripts/core/schools.mjs";
import { MATERIAL_ITEM_TYPES } from "../scripts/core/constants.mjs";

/* -------------------------------------------- */
/*  Materials                                    */
/* -------------------------------------------- */

test("the five Athasian materials are present", () => {
  assert.deepEqual([...MATERIAL_KEYS].sort(), ["bone", "metal", "obsidian", "stone", "wood"]);
});

test("materials carry the fields dnd5e's ItemPropertyConfiguration requires", () => {
  for ( const [key, config] of Object.entries(MATERIAL_PROPERTIES) ) {
    assert.equal(typeof config.label, "string", `${key} label`);
  }
});

test("materials are not flagged resistance-piercing", () => {
  // isPhysical is how dnd5e groups adamantine and silvered. Athasian
  // materials are descriptive; flagging them would change damage maths.
  for ( const [key, config] of Object.entries(MATERIAL_PROPERTIES) ) {
    assert.equal(config.isPhysical, undefined, `${key} must not set isPhysical`);
  }
});

test("materials merge into the system property table without displacing anything", () => {
  const existing = { ada: { label: "Adamantine" }, mgc: { label: "Magical" } };
  const merged = buildItemProperties(existing);
  assert.ok("ada" in merged, "system properties survive");
  assert.ok("mgc" in merged);
  for ( const key of MATERIAL_KEYS ) assert.ok(key in merged, `${key} added`);
});

test("buildItemProperties does not mutate its input", () => {
  const existing = { ada: {} };
  buildItemProperties(existing);
  assert.deepEqual(Object.keys(existing), ["ada"]);
});

test("materials are valid on weapons and on armour", () => {
  // dnd5e models armour as the `equipment` item type.
  assert.deepEqual(MATERIAL_ITEM_TYPES, ["weapon", "equipment"]);

  const existing = {
    weapon: new Set(["ada", "fin"]),
    equipment: new Set(["ada"]),
    spell: new Set(["vocal"])
  };
  const merged = buildValidProperties(existing);

  for ( const type of MATERIAL_ITEM_TYPES ) {
    for ( const key of MATERIAL_KEYS ) {
      assert.ok(merged[type].has(key), `${key} valid on ${type}`);
    }
  }
  assert.ok(merged.weapon.has("fin"), "existing weapon properties survive");
  assert.ok(merged.equipment.has("ada"), "existing equipment properties survive");
});

test("materials are not added to item types that should not have them", () => {
  const existing = { weapon: new Set(), equipment: new Set(), spell: new Set(["vocal"]) };
  const merged = buildValidProperties(existing);
  for ( const key of MATERIAL_KEYS ) {
    assert.ok(!merged.spell.has(key), `${key} must not appear on spells`);
  }
});

test("buildValidProperties handles an item type the system has not defined", () => {
  const merged = buildValidProperties({});
  for ( const type of MATERIAL_ITEM_TYPES ) {
    assert.ok(merged[type] instanceof Set, `${type} created`);
    assert.equal(merged[type].size, MATERIAL_KEYS.length);
  }
});

test("buildValidProperties does not mutate the Sets it is given", () => {
  const weapon = new Set(["ada"]);
  buildValidProperties({ weapon });
  assert.deepEqual([...weapon], ["ada"], "the system's own Set is untouched");
});

/* -------------------------------------------- */
/*  Psionics                                     */
/* -------------------------------------------- */

test("the Psionic school carries the fields dnd5e's typedef requires", () => {
  assert.equal(typeof PSIONIC_SCHOOL.label, "string");
  assert.equal(typeof PSIONIC_SCHOOL.icon, "string");
  assert.equal(PSIONIC_SCHOOL.fullKey, "psionic", "enrichers accept the long form");
});

test("the Psionic school merges beside the eight standard schools", () => {
  const existing = {
    abj: {}, con: {}, div: {}, enc: {}, evo: {}, ill: {}, nec: {}, trs: {}
  };
  const merged = buildSpellSchools(existing);
  assert.equal(Object.keys(merged).length, 9);
  assert.ok(PSIONIC_KEY in merged);
  for ( const key of Object.keys(existing) ) assert.ok(key in merged, `${key} survives`);
});

test("buildSpellSchools does not mutate its input", () => {
  const existing = { abj: {} };
  buildSpellSchools(existing);
  assert.deepEqual(Object.keys(existing), ["abj"]);
});

test("the Psionic key does not collide with a standard school", () => {
  const standard = ["abj", "con", "div", "enc", "evo", "ill", "nec", "trs"];
  assert.ok(!standard.includes(PSIONIC_KEY));
});
