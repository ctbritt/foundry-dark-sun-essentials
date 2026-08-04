import test from "node:test";
import assert from "node:assert/strict";

import {
  MATERIAL_KEYS,
  MATERIAL_PROPERTIES,
  buildItemProperties,
  buildValidProperties
} from "../scripts/core/materials.mjs";
import {
  PSIONIC_KEY,
  PSIONIC_PROPERTY,
  PSIONIC_SCHOOL,
  buildPsionicProperty,
  buildPsionicValidProperties,
  buildSpellSchools
} from "../scripts/core/psionics.mjs";
import {
  SILT_KEY,
  SILT_UNDERLAY_SOURCE,
  SILT_VEHICLE,
  buildVehicleTypes
} from "../scripts/core/vehicles.mjs";
import { MATERIAL_ITEM_TYPES, PSIONIC_ITEM_TYPES } from "../scripts/core/constants.mjs";

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

test("the Psionic property carries the fields dnd5e's typedef requires", () => {
  assert.equal(typeof PSIONIC_PROPERTY.label, "string");
  assert.equal(typeof PSIONIC_PROPERTY.icon, "string");
});

test("the Psionic property is not flagged resistance-piercing", () => {
  // isPhysical means "bypasses damage resistance", which is how dnd5e groups
  // adamantine and silvered. Psionic origin is descriptive, like the materials.
  assert.equal(PSIONIC_PROPERTY.isPhysical, undefined);
});

test("the Psionic property does not collide with a dnd5e property key", () => {
  // The keys dnd5e 5.3.3 ships. `psi` must not shadow one of them.
  const stock = ["ada", "amm", "fin", "fir", "foc", "hvy", "lgt", "lod", "mgc",
    "rch", "rel", "ret", "sil", "spc", "thr", "two", "ver", "vocal", "somatic",
    "material", "concentration", "ritual", "stealthDisadvantage", "weightlessContents"];
  assert.ok(!stock.includes(PSIONIC_KEY));
});

test("the Psionic property merges without displacing system properties", () => {
  const existing = { ada: { label: "Adamantine" }, mgc: { label: "Magical" } };
  const merged = buildPsionicProperty(existing);
  assert.ok("ada" in merged, "system properties survive");
  assert.ok("mgc" in merged);
  assert.deepEqual(merged[PSIONIC_KEY], PSIONIC_PROPERTY);
});

test("the definitions handed to CONFIG are writable copies, not the frozen originals", () => {
  // dnd5e localizes config tables by writing back into them in place. Handing
  // it a frozen definition throws and takes the rest of its localization pass
  // down with it. See thaw() in core/config-tables.mjs.
  const built = {
    ...buildPsionicProperty({}),
    ...buildItemProperties({}),
    ...buildSpellSchools({})
  };

  for ( const [key, definition] of Object.entries(built) ) {
    assert.ok(!Object.isFrozen(definition), `${key} was handed over frozen`);
    assert.doesNotThrow(() => { definition.label = "localized"; }, `${key} is not writable`);
  }

  // And the originals are still frozen, so the core cannot be edited by accident.
  assert.ok(Object.isFrozen(PSIONIC_PROPERTY));
  assert.ok(Object.isFrozen(PSIONIC_SCHOOL));
  assert.ok(Object.isFrozen(MATERIAL_PROPERTIES.obsidian));
});

test("buildPsionicProperty does not mutate its input", () => {
  const existing = { ada: {} };
  buildPsionicProperty(existing);
  assert.deepEqual(Object.keys(existing), ["ada"]);
});

test("the Psionic property is valid on powers, arms, gear, consumables and features", () => {
  assert.deepEqual(PSIONIC_ITEM_TYPES, ["spell", "weapon", "equipment", "consumable", "feat"]);

  const existing = {
    weapon: new Set(["ada", "fin"]),
    equipment: new Set(["ada"]),
    spell: new Set(["vocal"]),
    consumable: new Set(),
    feat: new Set()
  };
  const merged = buildPsionicValidProperties(existing);

  for ( const type of PSIONIC_ITEM_TYPES ) {
    assert.ok(merged[type].has(PSIONIC_KEY), `psi valid on ${type}`);
  }
  assert.ok(merged.weapon.has("fin"), "existing weapon properties survive");
  assert.ok(merged.spell.has("vocal"), "existing spell properties survive");
});

test("the Psionic property is not added to item types that should not have them", () => {
  const existing = { spell: new Set(), weapon: new Set(), tool: new Set(["foc"]) };
  const merged = buildPsionicValidProperties(existing);
  assert.ok(!merged.tool.has(PSIONIC_KEY), "psi must not appear on tools");
});

test("buildPsionicValidProperties creates item types the system has not defined", () => {
  const merged = buildPsionicValidProperties({});
  for ( const type of PSIONIC_ITEM_TYPES ) {
    assert.ok(merged[type] instanceof Set, `${type} created`);
    assert.deepEqual([...merged[type]], [PSIONIC_KEY]);
  }
});

test("buildPsionicValidProperties does not mutate the Sets it is given", () => {
  const weapon = new Set(["ada"]);
  buildPsionicValidProperties({ weapon });
  assert.deepEqual([...weapon], ["ada"], "the system's own Set is untouched");
});

test("materials and psionics compose rather than overwriting each other", () => {
  // Both features write to the same two tables. Enabling both must leave a
  // weapon able to carry `obsidian` and `psi` at once — this is the ordering
  // bug that would only show up with both toggles on.
  const properties = buildPsionicProperty(buildItemProperties({ ada: {} }));
  for ( const key of MATERIAL_KEYS ) assert.ok(key in properties, `${key} survives`);
  assert.ok(PSIONIC_KEY in properties, "psi survives");
  assert.ok("ada" in properties, "system properties survive");

  const valid = buildPsionicValidProperties(buildValidProperties({ weapon: new Set(["fin"]) }));
  assert.ok(valid.weapon.has("obsidian"), "material survives on weapons");
  assert.ok(valid.weapon.has(PSIONIC_KEY), "psi survives on weapons");
  assert.ok(valid.weapon.has("fin"), "system property survives on weapons");
  assert.ok(valid.spell.has(PSIONIC_KEY), "psi reaches spells");
  assert.ok(!valid.spell.has("obsidian"), "materials must not reach spells");
});

/* -------------------------------------------- */
/*  Silt vehicles                                */
/* -------------------------------------------- */

test("silt merges beside the four standard vehicle types", () => {
  const existing = {
    air: "DND5E.VEHICLE.Type.Air.label",
    land: "DND5E.VEHICLE.Type.Land.label",
    space: "DND5E.VEHICLE.Type.Space.label",
    water: "DND5E.VEHICLE.Type.Water.label"
  };
  const merged = buildVehicleTypes(existing);
  assert.equal(Object.keys(merged).length, 5);
  assert.equal(merged[SILT_KEY], SILT_VEHICLE);
  for ( const key of Object.keys(existing) ) assert.ok(key in merged, `${key} survives`);
});

test("buildVehicleTypes does not mutate its input", () => {
  const existing = { land: "DND5E.VEHICLE.Type.Land.label" };
  buildVehicleTypes(existing);
  assert.deepEqual(Object.keys(existing), ["land"]);
});

test("the vehicle type value is a bare string, as dnd5e pre-localizes it", () => {
  // preLocalize("vehicleTypes", { sort: true }) is registered with no `keys`,
  // so an object here logs a console error at i18nInit instead of localizing.
  assert.equal(typeof SILT_VEHICLE, "string");
});

test("the silt key does not collide with a standard vehicle type", () => {
  assert.ok(!["air", "land", "space", "water"].includes(SILT_KEY));
});

test("the sheet underlay borrows a type dnd5e actually defines", () => {
  // dnd5e's stylesheet only declares --underlay-vehicle-{land,water,air,space}.
  // Aliasing silt to anything else would resolve to nothing.
  assert.ok(["land", "water", "air", "space"].includes(SILT_UNDERLAY_SOURCE));
});
