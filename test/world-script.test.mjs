/**
 * Tests for the world-script edition.
 *
 * The script is a classic script, not a module, so it is loaded the way Foundry
 * loads it: globals stubbed, source evaluated, `init` fired. The assertions that
 * matter are the ones about *identity* — the whole point of the world script's
 * approach is that it mutates the config tables dnd5e already holds rather than
 * replacing them, so `CurrencyTemplate`'s captured `initialKeys` reference stays
 * live no matter when the schema gets built.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../world-script/dark-sun-essentials.js", import.meta.url)),
  "utf8"
);

/* -------------------------------------------- */
/*  Harness                                      */
/* -------------------------------------------- */

function makeItem(id, price) {
  return { id, system: price ? { price } : {} };
}

/**
 * Stand up a stubbed Foundry, evaluate the script, and run `init`.
 * @param {object} [options]
 * @param {string} [options.flags]     Source-level overrides, e.g. "removeLegacyCurrency: true".
 * @param {boolean} [options.noDnd5e]  Omit CONFIG.DND5E entirely.
 * @returns {object}  Handles for assertions.
 */
function boot({ flags = {}, noDnd5e = false } = {}) {
  let source = SOURCE;
  for ( const [key, value] of Object.entries(flags) ) {
    const pattern = new RegExp(`(${key}:\\s*)(true|false)`);
    assert.match(source, pattern, `flag ${key} not found in source`);
    source = source.replace(pattern, `$1${value}`);
  }

  // Real dnd5e 5.3.3 shapes: currencies carry conversion rates, validProperties
  // values are Sets, vehicleTypes values are bare strings.
  const currencies = {
    pp: { conversion: 0.1 }, gp: { conversion: 1 }, ep: { conversion: 2 },
    sp: { conversion: 10 }, cp: { conversion: 100 }
  };
  const spellSchools = { abj: { label: "DND5E.SchoolAbj" } };
  const itemProperties = { ada: { label: "DND5E.ITEM.Property.Adamantine", isPhysical: true } };
  const validProperties = {
    weapon: new Set(["ada", "fin"]),
    equipment: new Set(["ada", "foc"]),
    spell: new Set(["vocal"])
  };
  const vehicleTypes = { air: "Air Vehicle", land: "Land Vehicle", water: "Water Vehicle" };

  const identity = { currencies, spellSchools, itemProperties, vehicleTypes,
    weaponSet: validProperties.weapon, equipmentSet: validProperties.equipment };

  const hooks = new Map();
  const notifications = { info: [], warn: [], error: [] };
  const styles = [];
  const logs = { log: [], warn: [], error: [] };

  const actors = [
    {
      id: "hero", name: "Sorak",
      system: { currency: { pp: 1, gp: 5, ep: 2, sp: 3, cp: 7 } },
      items: [makeItem("blade", { value: 15, denomination: "gp" }), makeItem("rope")],
      updateEmbeddedDocuments: async (_t, u) => u
    },
    {
      id: "athasian", name: "Templar",
      system: { currency: { ct: 12, cb: 3, lb: 4 } },
      items: [makeItem("ceramic", { value: 2, denomination: "ct" })],
      updateEmbeddedDocuments: async (_t, u) => u
    }
  ];
  actors.get = id => actors.find(a => a.id === id);

  const scenes = [{
    id: "tyr", name: "Tyr",
    tokens: [
      { id: "t1", actorLink: false, actor: { system: { currency: { gp: 3 } } } },
      { id: "t2", actorLink: true, actor: { system: { currency: { gp: 99 } } } },
      { id: "t3", actorLink: false, actor: null }
    ],
    updateEmbeddedDocuments: async (_t, u) => u
  }];
  scenes.get = id => scenes.find(s => s.id === id);

  globalThis.CONFIG = noDnd5e ? {} : {
    DND5E: { currencies, defaultCurrency: "gp", spellSchools, itemProperties, validProperties, vehicleTypes }
  };
  globalThis.Hooks = { once: (name, fn) => hooks.set(name, fn) };
  globalThis.game = {
    user: { isGM: true },
    actors,
    items: [makeItem("world-sword", { value: 8, denomination: "sp" })],
    scenes,
    packs: [{ documentName: "Actor" }, { documentName: "Item" }, { documentName: "JournalEntry" }]
  };
  globalThis.ui = { notifications: {
    info: m => notifications.info.push(m),
    warn: m => notifications.warn.push(m),
    error: m => notifications.error.push(m)
  } };
  globalThis.document = {
    createElement: () => ({ set textContent(v) { this._css = v; }, get textContent() { return this._css; } }),
    head: { appendChild: el => styles.push(el.textContent) }
  };
  globalThis.Actor = { updateDocuments: async u => u };
  globalThis.Item = { updateDocuments: async u => u };

  const realConsole = globalThis.console;
  globalThis.console = {
    log: (...a) => logs.log.push(a.join(" ")),
    warn: (...a) => logs.warn.push(a.join(" ")),
    error: (...a) => logs.error.push(a.join(" "))
  };

  try {
    (0, eval)(source);
    hooks.get("init")?.();
  } finally {
    globalThis.console = realConsole;
  }

  return { identity, notifications, styles, logs, dnd5e: globalThis.CONFIG.DND5E, api: globalThis.game.darkSun };
}

/* -------------------------------------------- */
/*  Config application                           */
/* -------------------------------------------- */

test("mutates the config tables in place rather than replacing them", () => {
  const { identity, dnd5e } = boot();

  // This is the bug the module's replace-the-object approach is exposed to:
  // CurrencyTemplate captured this exact object as initialKeys.
  assert.equal(dnd5e.currencies, identity.currencies, "currencies object was replaced");
  assert.equal(dnd5e.spellSchools, identity.spellSchools, "spellSchools object was replaced");
  assert.equal(dnd5e.itemProperties, identity.itemProperties, "itemProperties object was replaced");
  assert.equal(dnd5e.vehicleTypes, identity.vehicleTypes, "vehicleTypes object was replaced");
  assert.equal(dnd5e.validProperties.weapon, identity.weaponSet, "weapon Set was replaced");
  assert.equal(dnd5e.validProperties.equipment, identity.equipmentSet, "equipment Set was replaced");
});

test("adds ceramic coinage at gp/sp/cp parity and repoints defaultCurrency", () => {
  const { dnd5e } = boot();

  assert.equal(dnd5e.currencies.ct.conversion, 1);
  assert.equal(dnd5e.currencies.cb.conversion, 10);
  assert.equal(dnd5e.currencies.lb.conversion, 100);
  assert.equal(dnd5e.defaultCurrency, "ct");

  // Legacy coins survive by default.
  for ( const key of ["pp", "gp", "ep", "sp", "cp"] ) assert.ok(key in dnd5e.currencies, key);

  // preparePhysicalData() early-returns if defaultCurrency is not a real coin.
  assert.ok(dnd5e.defaultCurrency in dnd5e.currencies);
});

test("coin icons are self-contained data URIs, not module paths", () => {
  const { dnd5e } = boot();
  for ( const key of ["ct", "cb", "lb"] ) {
    assert.match(dnd5e.currencies[key].icon, /^data:image\/svg\+xml,/, key);
    assert.doesNotMatch(dnd5e.currencies[key].icon, /modules\//, key);
  }
  assert.match(dnd5e.spellSchools.psi.icon, /^data:image\/svg\+xml,/);
});

test("labels are literals, since there is no language file to resolve keys against", () => {
  const { dnd5e } = boot();
  assert.equal(dnd5e.currencies.ct.label, "Ceramic Token");
  assert.equal(dnd5e.spellSchools.psi.label, "Psionic");
  assert.equal(dnd5e.itemProperties.obsidian.label, "Obsidian");
  // A dotted i18n key here would render raw if the key were ever missing.
  assert.doesNotMatch(dnd5e.currencies.ct.label, /^[a-z-]+\./);
});

test("adds the psionic school with a resolvable fullKey", () => {
  const { dnd5e } = boot();
  assert.equal(dnd5e.spellSchools.psi.fullKey, "psionic");
  assert.ok(dnd5e.spellSchools.abj, "existing schools survive");
});

test("adds material properties to weapons and armour only", () => {
  const { dnd5e } = boot();
  const materials = ["wood", "bone", "stone", "obsidian", "metal"];

  for ( const key of materials ) {
    assert.ok(key in dnd5e.itemProperties, `${key} missing from itemProperties`);
    assert.ok(dnd5e.validProperties.weapon.has(key), `${key} not valid on weapons`);
    assert.ok(dnd5e.validProperties.equipment.has(key), `${key} not valid on equipment`);
    assert.ok(!dnd5e.validProperties.spell.has(key), `${key} leaked onto spells`);
  }

  // Descriptive tags: they must not claim to pierce resistance.
  for ( const key of materials ) assert.ok(!dnd5e.itemProperties[key].isPhysical, key);
  assert.ok(dnd5e.validProperties.weapon.has("fin"), "existing weapon properties survive");
});

/* -------------------------------------------- */
/*  Silt vehicles                                */
/* -------------------------------------------- */

test("adds the silt vehicle type as a bare string, matching dnd5e's table", () => {
  const { dnd5e } = boot();
  assert.equal(dnd5e.vehicleTypes.silt, "Silt Vehicle");
  assert.equal(typeof dnd5e.vehicleTypes.silt, "string",
    "vehicleTypes values are pre-localized as strings, not objects");
  assert.ok(dnd5e.vehicleTypes.land, "stock vehicle types survive");
});

test("supplies the sheet underlay dnd5e does not define for silt", () => {
  const { styles } = boot();
  assert.equal(styles.length, 1);
  assert.match(styles[0], /--underlay-vehicle-silt:\s*var\(--underlay-vehicle-water\)/);
});

test("silt vehicles can be turned off independently", () => {
  const { dnd5e, styles } = boot({ flags: { siltVehicles: false } });
  assert.ok(!("silt" in dnd5e.vehicleTypes));
  assert.equal(styles.length, 0);
  assert.ok(dnd5e.currencies.ct, "other features still applied");
});

/* -------------------------------------------- */
/*  Destructive paths                            */
/* -------------------------------------------- */

test("legacy removal strips the standard five and says so loudly", () => {
  const { dnd5e, logs } = boot({ flags: { removeLegacyCurrency: true } });
  for ( const key of ["pp", "gp", "ep", "sp", "cp"] ) {
    assert.ok(!(key in dnd5e.currencies), `${key} survived removal`);
  }
  assert.ok(dnd5e.currencies.ct, "ceramic replaced them");
  assert.equal(dnd5e.defaultCurrency, "ct");
  assert.ok(logs.warn.some(m => /unreadable/.test(m)), "no warning about unreadable balances");
});

test("legacy removal is refused when there is no ceramic coin to replace them", () => {
  const { dnd5e, logs } = boot({
    flags: { ceramicCurrency: false, removeLegacyCurrency: true }
  });
  assert.ok(dnd5e.currencies.gp, "gold was stripped with nothing to replace it");
  assert.equal(dnd5e.defaultCurrency, "gp", "defaultCurrency was moved to a coin that does not exist");
  assert.ok(logs.warn.some(m => /ignored/.test(m)));
});

test("does nothing and reports it when the system is not dnd5e", () => {
  const { logs, api } = boot({ noDnd5e: true });
  assert.ok(logs.error.some(m => /CONFIG\.DND5E is missing/.test(m)));
  assert.equal(api, undefined, "no API surface should be published");
});

/* -------------------------------------------- */
/*  Migration arithmetic                         */
/* -------------------------------------------- */

test("scan folds every standard coin into ceramic exactly", () => {
  const { api } = boot();
  const plan = api.scanWorld();

  // 1pp + 5gp + 2ep + 3sp + 7cp = 10 + 5 + 1 + 0.3 + 0.07 gp = 16.37 gp = 1637 lb.
  const hero = plan.actors.find(u => u._id === "hero");
  assert.deepEqual(hero.system.currency, { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ct: 16, cb: 3, lb: 7 });
  assert.equal(plan.remainder, 0, "standard denominations must divide cleanly");
});

test("scan leaves an already-converted purse alone, so it is safe to re-run", () => {
  const { api } = boot();
  const plan = api.scanWorld();
  assert.ok(!plan.actors.some(u => u._id === "athasian"), "ceramic-only purse was rewritten");
});

test("scan restates prices without changing the printed number", () => {
  const { api } = boot();
  const plan = api.scanWorld();

  // 15 gp -> 15 ct, 8 sp -> 8 cb. Same numeral, Athasian coin.
  assert.deepEqual(plan.embedded.get("hero"), [
    { _id: "blade", system: { price: { value: 15, denomination: "ct" } } }
  ]);
  assert.deepEqual(plan.items, [
    { _id: "world-sword", system: { price: { value: 8, denomination: "cb" } } }
  ]);
});

test("scan converts unlinked tokens and skips linked ones", () => {
  const { api } = boot();
  const updates = api.scanWorld().synthetic.get("tyr");
  assert.equal(updates.length, 1);
  assert.equal(updates[0]._id, "t1");
  assert.equal(updates[0].delta.system.currency.ct, 3);
});

test("scan counts compendium packs rather than touching them", () => {
  const { api } = boot();
  const summary = api.summarise(api.scanWorld());
  assert.equal(summary.compendiums, 2, "Actor and Item packs only");
  assert.equal(summary.actors, 1);
  assert.equal(summary.items, 2);
  assert.equal(summary.tokens, 1);
  assert.ok(!summary.empty);
});

test("convertCurrency defaults to a dry run and writes nothing", async () => {
  const { api, notifications } = boot();
  const writes = [];
  globalThis.Actor.updateDocuments = async u => { writes.push(u); return u; };

  const summary = await api.convertCurrency();

  assert.equal(writes.length, 0, "a dry run wrote to the world");
  assert.equal(summary.actors, 1);
  assert.ok(notifications.info.some(m => /Dry run/.test(m)));
});

test("convertCurrency writes only when explicitly committed", async () => {
  const { api, notifications } = boot();
  const writes = [];
  globalThis.Actor.updateDocuments = async u => { writes.push(u); return u; };

  const result = await api.convertCurrency({ commit: true });

  assert.equal(writes.length, 1);
  assert.equal(result.actors, 1);
  assert.equal(result.tokens, 1);
  assert.deepEqual(result.errors, []);
  assert.ok(notifications.info.some(m => /Converted 1 actors/.test(m)));
});

test("one failing collection does not abort the rest of the run", async () => {
  const { api, notifications } = boot();
  globalThis.Actor.updateDocuments = async () => { throw new Error("locked"); };

  const result = await api.convertCurrency({ commit: true });

  assert.equal(result.actors, 0);
  assert.equal(result.items, 2, "items still converted after actors failed");
  assert.equal(result.errors.length, 1);
  assert.ok(notifications.error.some(m => /operations failed/.test(m)));
});

test("convertCurrency refuses to run for a player", async () => {
  const { api, notifications } = boot();
  globalThis.game.user.isGM = false;
  assert.equal(await api.convertCurrency({ commit: true }), null);
  assert.ok(notifications.error.some(m => /Only the GM/.test(m)));
});
