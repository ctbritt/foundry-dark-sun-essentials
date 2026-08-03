/**
 * Migration tests against a stubbed world.
 *
 * This is the code that rewrites actor data. It gets a world with the awkward
 * cases in it — an actor with no currency at all, an unlinked token, a locked
 * compendium, a document that throws on update — and is checked on what it
 * proposes before it is checked on what it writes.
 */

import test from "node:test";
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  World fixture                                */
/* -------------------------------------------- */

function makeItem(id, price) {
  return { id, system: price ? { price } : {} };
}

/**
 * Build a stub world.
 * @param {object} [options]
 * @param {string[]} [options.failOn]  Labels that should throw on update.
 */
function stubWorld({ failOn = [] } = {}) {
  const writes = { actors: [], items: [], embedded: [], tokens: [] };

  globalThis.CONFIG = {
    DND5E: {
      currencies: {
        pp: { conversion: 0.1 }, gp: { conversion: 1 }, ep: { conversion: 2 },
        sp: { conversion: 10 }, cp: { conversion: 100 },
        ct: { conversion: 1 }, cb: { conversion: 10 }, lb: { conversion: 100 }
      }
    }
  };

  const actors = [
    {
      id: "hero", name: "Sorak",
      system: { currency: { pp: 1, gp: 5, ep: 2, sp: 3, cp: 7 } },
      items: [makeItem("blade", { value: 15, denomination: "gp" }), makeItem("rope")]
    },
    {
      id: "broke", name: "Beggar",
      system: { currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 } },
      items: []
    },
    {
      // A vehicle or similar type with no currency in its schema at all.
      id: "wagon", name: "Silt Skimmer",
      system: {},
      items: [makeItem("cargo", { value: 4, denomination: "cp" })]
    },
    {
      // Already converted: should be left completely alone.
      id: "athasian", name: "Templar",
      system: { currency: { ct: 12, cb: 3, lb: 4 } },
      items: [makeItem("ceramic", { value: 2, denomination: "ct" })]
    }
  ];
  actors.get = id => actors.find(a => a.id === id);

  for ( const actor of actors ) {
    actor.updateEmbeddedDocuments = async (_type, updates) => {
      if ( failOn.includes(actor.id) ) throw new Error(`locked: ${actor.name}`);
      writes.embedded.push({ actor: actor.id, updates });
      return updates;
    };
  }

  const scenes = [{
    id: "tyr", name: "Tyr",
    tokens: [
      { id: "t1", actorLink: false, actor: { system: { currency: { gp: 3 } } } },
      { id: "t2", actorLink: true, actor: { system: { currency: { gp: 99 } } } },
      { id: "t3", actorLink: false, actor: null }
    ],
    updateEmbeddedDocuments: async (_type, updates) => {
      writes.tokens.push({ scene: "tyr", updates });
      return updates;
    }
  }];
  scenes.get = id => scenes.find(s => s.id === id);

  const items = [
    makeItem("sidebar-a", { value: 2, denomination: "pp" }),
    makeItem("sidebar-b", { value: 8, denomination: "sp" }),
    makeItem("sidebar-c", { value: 1, denomination: "ct" })
  ];

  globalThis.game = {
    actors, items, scenes,
    packs: [
      { documentName: "Actor" }, { documentName: "Item" }, { documentName: "JournalEntry" }
    ],
    i18n: { localize: k => k, format: k => k },
    user: { isGM: true }
  };

  globalThis.Actor = {
    updateDocuments: async updates => {
      if ( failOn.includes("actors") ) throw new Error("actor collection locked");
      writes.actors.push(...updates);
      return updates;
    }
  };
  globalThis.Item = {
    updateDocuments: async updates => {
      writes.items.push(...updates);
      return updates;
    }
  };
  globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

  return writes;
}

async function importMigration() {
  const url = new URL("../scripts/migration.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
}

/* -------------------------------------------- */
/*  Scanning                                     */
/* -------------------------------------------- */

test("the scan finds only the actors actually holding standard coin", async () => {
  stubWorld();
  const { scanWorld } = await importMigration();

  const plan = scanWorld();

  assert.equal(plan.actors.length, 1, "one actor has coin worth converting");
  assert.equal(plan.actors[0]._id, "hero");
});

test("an actor with an empty purse proposes no write", async () => {
  stubWorld();
  const { scanWorld } = await importMigration();
  const ids = scanWorld().actors.map(u => u._id);
  assert.ok(!ids.includes("broke"));
});

test("an actor type with no currency field is skipped without error", async () => {
  stubWorld();
  const { scanWorld } = await importMigration();
  const ids = scanWorld().actors.map(u => u._id);
  assert.ok(!ids.includes("wagon"));
});

test("an already-converted actor is left alone", async () => {
  stubWorld();
  const { scanWorld } = await importMigration();
  const ids = scanWorld().actors.map(u => u._id);
  assert.ok(!ids.includes("athasian"), "no standard coin means no rewrite");
});

test("the scan converts a mixed purse exactly", async () => {
  stubWorld();
  const { scanWorld } = await importMigration();

  const { system } = scanWorld().actors[0];
  // 1pp=1000, 5gp=500, 2ep=100, 3sp=30, 7cp=7 -> 1637 beads -> 16ct 3cb 7lb
  assert.deepEqual(
    { ct: system.currency.ct, cb: system.currency.cb, lb: system.currency.lb },
    { ct: 16, cb: 3, lb: 7 }
  );
  for ( const coin of ["pp", "gp", "ep", "sp", "cp"] ) {
    assert.equal(system.currency[coin], 0, `${coin} zeroed`);
  }
});

test("sidebar item prices are repriced, ceramic ones ignored", async () => {
  stubWorld();
  const { scanWorld } = await importMigration();

  const plan = scanWorld();
  assert.equal(plan.items.length, 2, "the ceramic-priced item is untouched");
  const byId = Object.fromEntries(plan.items.map(u => [u._id, u.system.price]));
  assert.deepEqual(byId["sidebar-a"], { value: 20, denomination: "ct" }, "2pp -> 20ct");
  assert.deepEqual(byId["sidebar-b"], { value: 8, denomination: "cb" }, "8sp -> 8cb");
});

test("carried items are repriced too", async () => {
  stubWorld();
  const { scanWorld } = await importMigration();

  const plan = scanWorld();
  assert.deepEqual(plan.embedded.get("hero"),
    [{ _id: "blade", system: { price: { value: 15, denomination: "ct" } } }]);
  assert.ok(!plan.embedded.has("athasian"), "an item already in ceramic proposes nothing");
});

test("unlinked tokens are converted; linked ones are left to their actor", async () => {
  stubWorld();
  const { scanWorld } = await importMigration();

  const updates = scanWorld().synthetic.get("tyr");
  assert.equal(updates.length, 1, "only the unlinked token with currency");
  assert.equal(updates[0]._id, "t1");
  assert.equal(updates[0].delta.system.currency.ct, 3, "3gp -> 3ct");
});

test("compendium packs are counted, not converted", async () => {
  stubWorld();
  const { scanWorld, summarise } = await importMigration();

  const summary = summarise(scanWorld());
  assert.equal(summary.compendiums, 2, "the two Actor/Item packs, not the journal pack");
});

test("the summary totals what the GM is about to change", async () => {
  stubWorld();
  const { scanWorld, summarise } = await importMigration();

  const summary = summarise(scanWorld());
  assert.equal(summary.actors, 1);
  assert.equal(summary.items, 4, "2 sidebar + 2 carried (the wagon's cargo counts)");
  assert.equal(summary.tokens, 1);
  assert.equal(summary.empty, false);
  assert.equal(summary.remainder, 0, "the standard coins convert exactly");
});

test("a world with nothing to convert reports empty", async () => {
  stubWorld();
  game.actors.length = 0;
  game.items.length = 0;
  game.scenes.length = 0;
  const { scanWorld, summarise } = await importMigration();

  assert.equal(summarise(scanWorld()).empty, true);
});

/* -------------------------------------------- */
/*  Applying                                     */
/* -------------------------------------------- */

test("applying a plan writes actors, items and tokens", async () => {
  const writes = stubWorld();
  const { scanWorld, applyMigration } = await importMigration();

  const result = await applyMigration(scanWorld());

  assert.deepEqual(result.errors, []);
  assert.equal(result.actors, 1);
  assert.equal(result.items, 4);
  assert.equal(result.tokens, 1);
  assert.equal(writes.actors.length, 1);
  assert.equal(writes.items.length, 2);
  assert.equal(writes.embedded.length, 2, "the hero and the wagon both carry priced gear");
  assert.equal(writes.tokens.length, 1);
});

test("migration is idempotent — a second pass finds nothing", async () => {
  stubWorld();
  const { scanWorld, summarise } = await importMigration();

  // Apply the first plan to the fixture by hand, as Foundry would.
  const plan = scanWorld();
  for ( const update of plan.actors ) {
    Object.assign(game.actors.get(update._id).system.currency, update.system.currency);
  }
  for ( const [actorId, updates] of plan.embedded ) {
    for ( const update of updates ) {
      const item = game.actors.get(actorId).items.find(i => i.id === update._id);
      item.system.price = update.system.price;
    }
  }
  for ( const item of game.items ) {
    const update = plan.items.find(u => u._id === item.id);
    if ( update ) item.system.price = update.system.price;
  }
  for ( const update of plan.synthetic.get("tyr") ) {
    const token = game.scenes.get("tyr").tokens.find(t => t.id === update._id);
    Object.assign(token.actor.system.currency, update.delta.system.currency);
  }

  assert.equal(summarise(scanWorld()).empty, true, "nothing left to do");
});

test("one failing document does not abort the rest of the run", async () => {
  const writes = stubWorld({ failOn: ["hero"] });
  const { scanWorld, applyMigration } = await importMigration();

  const result = await applyMigration(scanWorld());

  assert.equal(result.errors.length, 1, "the failure is reported");
  assert.match(result.errors[0], /Sorak/, "and names the document");
  assert.equal(result.actors, 1, "actor currency still went through");
  assert.equal(writes.items.length, 2, "sidebar items still went through");
  assert.equal(result.items, 3, "the wagon's cargo converted; only the hero's gear failed");
  assert.equal(writes.tokens.length, 1, "tokens still went through");
});

test("a failure in the actor collection is caught, not thrown", async () => {
  stubWorld({ failOn: ["actors"] });
  const { scanWorld, applyMigration } = await importMigration();

  const result = await applyMigration(scanWorld());

  assert.equal(result.actors, 0);
  assert.match(result.errors[0], /Actor currency/);
  assert.equal(result.items, 4, "the rest of the world still converted");
});
