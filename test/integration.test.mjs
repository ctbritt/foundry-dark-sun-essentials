/**
 * Adapter-level tests against a stubbed Foundry.
 *
 * These exist for two reasons. First, they exercise the real ESM import graph:
 * a module whose imports throw at evaluation time fails silently in Foundry,
 * with nothing in the UI to say why. Second, they run `applyConfig` against a
 * faithful copy of dnd5e 5.3.3's configuration and assert on the result, which
 * is the closest thing to a real world load that runs in a terminal.
 */

import test from "node:test";
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Fixtures                                     */
/* -------------------------------------------- */

/** A faithful subset of CONFIG.DND5E as dnd5e 5.3.3 ships it. */
function dnd5eConfig() {
  return {
    currencies: {
      pp: { label: "DND5E.CurrencyPP", abbreviation: "DND5E.CurrencyAbbrPP", conversion: 0.1, icon: "" },
      gp: { label: "DND5E.CurrencyGP", abbreviation: "DND5E.CurrencyAbbrGP", conversion: 1, icon: "" },
      ep: { label: "DND5E.CurrencyEP", abbreviation: "DND5E.CurrencyAbbrEP", conversion: 2, icon: "" },
      sp: { label: "DND5E.CurrencySP", abbreviation: "DND5E.CurrencyAbbrSP", conversion: 10, icon: "" },
      cp: { label: "DND5E.CurrencyCP", abbreviation: "DND5E.CurrencyAbbrCP", conversion: 100, icon: "" }
    },
    defaultCurrency: "gp",
    spellSchools: {
      abj: {}, con: {}, div: {}, enc: {}, evo: {}, ill: {}, nec: {}, trs: {}
    },
    itemProperties: {
      ada: { label: "DND5E.ITEM.Property.Adamantine", isPhysical: true },
      mgc: { label: "DND5E.ITEM.Property.Magical" },
      fin: { label: "DND5E.ITEM.Property.Finesse" }
    },
    validProperties: {
      weapon: new Set(["ada", "fin", "mgc"]),
      equipment: new Set(["ada", "mgc"]),
      spell: new Set(["vocal", "somatic"]),
      tool: new Set(["mgc"])
    }
  };
}

/**
 * Install the globals a Foundry module expects at evaluation time.
 * @param {object} [settings]  Module setting values.
 * @returns {{warnings: string[], errors: string[]}}
 */
function stubFoundry(settings = {}) {
  const warnings = [];
  const errors = [];

  globalThis.CONFIG = { DND5E: dnd5eConfig() };

  globalThis.foundry = {
    applications: {
      api: {
        // Enough of the surface for the app modules to evaluate. They are
        // never rendered here; only their imports must resolve.
        ApplicationV2: class ApplicationV2 {},
        HandlebarsApplicationMixin: Base => class extends Base {},
        DialogV2: class DialogV2 {}
      },
      handlebars: { loadTemplates: async () => {} }
    },
    utils: {
      expandObject: o => ({ ...o }),
      escapeHTML: s => s
    }
  };

  globalThis.game = {
    version: "14.359",
    release: { generation: 14 },
    system: { version: "5.3.3" },
    user: { isGM: true },
    modules: new Map(),
    i18n: { localize: k => k, format: k => k },
    settings: {
      register: () => {},
      registerMenu: () => {},
      get: (_scope, key) => settings[key] ?? false,
      set: async () => {}
    }
  };

  globalThis.ui = {
    notifications: {
      warn: m => warnings.push(m),
      error: m => errors.push(m),
      info: () => {}
    }
  };

  globalThis.Hooks = { once: () => {}, on: () => {} };

  return { warnings, errors };
}

/** Import fresh each time; ESM caches, so bust it with a query string. */
async function importConfigApply() {
  const url = new URL("../scripts/config-apply.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
}

/* -------------------------------------------- */
/*  Import graph                                 */
/* -------------------------------------------- */

test("the whole module graph evaluates without throwing", async () => {
  stubFoundry();
  // main.mjs pulls in every other file, including both ApplicationV2 windows.
  // If any of them touch a global that does not exist yet, this is where a
  // silent load failure in Foundry becomes a visible test failure.
  const url = new URL("../scripts/main.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  await assert.doesNotReject(() => import(url.href));
});

/* -------------------------------------------- */
/*  Applying config                              */
/* -------------------------------------------- */

test("all features off leaves dnd5e exactly as it shipped", async () => {
  stubFoundry();
  const before = JSON.stringify(Object.keys(CONFIG.DND5E.currencies));
  const { applyConfig } = await importConfigApply();

  const { applied } = applyConfig();

  assert.deepEqual(applied, []);
  assert.equal(JSON.stringify(Object.keys(CONFIG.DND5E.currencies)), before);
  assert.equal(CONFIG.DND5E.defaultCurrency, "gp");
  assert.equal(Object.keys(CONFIG.DND5E.spellSchools).length, 8);
  assert.ok(!("wood" in CONFIG.DND5E.itemProperties));
});

test("ceramic coinage adds three coins and repoints the default", async () => {
  stubFoundry({ ceramicCurrency: true });
  const { applyConfig } = await importConfigApply();

  applyConfig();

  assert.deepEqual(Object.keys(CONFIG.DND5E.currencies).sort(),
    ["cb", "cp", "ct", "ep", "gp", "lb", "pp", "sp"]);
  assert.equal(CONFIG.DND5E.defaultCurrency, "ct");
  assert.equal(CONFIG.DND5E.currencies.ct.conversion, CONFIG.DND5E.currencies.gp.conversion,
    "a ceramic token is worth a gold piece");
});

test("removal strips the standard five and keeps the default valid", async () => {
  stubFoundry({ ceramicCurrency: true, removeLegacyCurrency: true });
  const { applyConfig } = await importConfigApply();

  applyConfig();

  assert.deepEqual(Object.keys(CONFIG.DND5E.currencies).sort(), ["cb", "ct", "lb"]);
  // dnd5e's preparePhysicalData() early-returns when defaultCurrency is not a
  // known currency, which silently kills all price conversion. Guard it.
  assert.ok(CONFIG.DND5E.defaultCurrency in CONFIG.DND5E.currencies,
    "defaultCurrency must still resolve, or item pricing stops working");
});

test("removal without ceramic coinage is refused, not obeyed", async () => {
  const { warnings } = stubFoundry({ removeLegacyCurrency: true });
  const { applyConfig } = await importConfigApply();

  applyConfig();

  assert.deepEqual(Object.keys(CONFIG.DND5E.currencies).sort(),
    ["cp", "ep", "gp", "pp", "sp"], "the world keeps its money");
  assert.equal(CONFIG.DND5E.defaultCurrency, "gp");
});

test("the psionic school joins the eight standard ones", async () => {
  stubFoundry({ psionicSchool: true });
  const { applyConfig } = await importConfigApply();

  applyConfig();

  assert.equal(Object.keys(CONFIG.DND5E.spellSchools).length, 9);
  assert.equal(CONFIG.DND5E.spellSchools.psi.fullKey, "psionic");
  assert.ok("abj" in CONFIG.DND5E.spellSchools, "the standard schools survive");
});

test("materials register on weapons and armour but nowhere else", async () => {
  stubFoundry({ materialProperties: true });
  const { applyConfig } = await importConfigApply();

  applyConfig();

  for ( const key of ["wood", "bone", "stone", "obsidian", "metal"] ) {
    assert.ok(key in CONFIG.DND5E.itemProperties, `${key} defined`);
    assert.ok(CONFIG.DND5E.validProperties.weapon.has(key), `${key} on weapons`);
    assert.ok(CONFIG.DND5E.validProperties.equipment.has(key), `${key} on armour`);
    assert.ok(!CONFIG.DND5E.validProperties.spell.has(key), `${key} not on spells`);
    assert.ok(!CONFIG.DND5E.validProperties.tool.has(key), `${key} not on tools`);
  }
  assert.ok(CONFIG.DND5E.validProperties.weapon.has("fin"), "system properties survive");
  assert.ok(CONFIG.DND5E.itemProperties.ada.isPhysical, "adamantine is untouched");
});

test("every feature at once composes cleanly", async () => {
  stubFoundry({
    ceramicCurrency: true, removeLegacyCurrency: true,
    psionicSchool: true, materialProperties: true
  });
  const { applyConfig } = await importConfigApply();

  const { applied, skipped } = applyConfig();

  assert.equal(skipped.length, 0);
  assert.equal(applied.length, 3);
  assert.deepEqual(Object.keys(CONFIG.DND5E.currencies).sort(), ["cb", "ct", "lb"]);
  assert.ok("psi" in CONFIG.DND5E.spellSchools);
  assert.ok(CONFIG.DND5E.validProperties.weapon.has("obsidian"));
});

/* -------------------------------------------- */
/*  Forward compatibility                        */
/* -------------------------------------------- */

test("a system that removed an extension point disables features instead of writing", async () => {
  // The dnd5e 6.0 scenario: the config the module writes to has moved.
  const { errors } = stubFoundry({ ceramicCurrency: true, psionicSchool: true });
  delete CONFIG.DND5E.validProperties;
  game.system.version = "6.0.0";

  const { applyConfig } = await importConfigApply();
  const { applied, skipped } = applyConfig();

  assert.deepEqual(applied, [], "nothing was written");
  assert.deepEqual(skipped, ["all"]);
  assert.equal(errors.length, 1, "the GM is told, once");
  assert.equal(CONFIG.DND5E.defaultCurrency, "gp", "config is left as found");
});

test("a system that changed an extension point's shape is also caught", async () => {
  const { errors } = stubFoundry({ materialProperties: true });
  // A plausible 6.0 change: validProperties values become arrays, not Sets.
  CONFIG.DND5E.validProperties.weapon = ["ada", "fin"];

  const { applyConfig } = await importConfigApply();
  const { applied } = applyConfig();

  assert.deepEqual(applied, []);
  assert.equal(errors.length, 1);
  assert.deepEqual(CONFIG.DND5E.validProperties.weapon, ["ada", "fin"], "left untouched");
});

test("verifyExtensionPoints names what it could not find", async () => {
  stubFoundry();
  delete CONFIG.DND5E.currencies;
  delete CONFIG.DND5E.spellSchools;

  const url = new URL("../scripts/compat.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  const { verifyExtensionPoints } = await import(url.href);

  const result = verifyExtensionPoints();
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.sort(),
    ["CONFIG.DND5E.currencies", "CONFIG.DND5E.spellSchools"]);
});

test("a healthy dnd5e 5.3.3 config passes verification", async () => {
  stubFoundry();
  const url = new URL("../scripts/compat.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  const { verifyExtensionPoints } = await import(url.href);

  const result = verifyExtensionPoints();
  assert.equal(result.ok, true, JSON.stringify(result));
});
