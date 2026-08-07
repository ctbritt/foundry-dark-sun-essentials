/**
 * Compendium migration tests against stubbed packs.
 *
 * Packs are the half of the migration that can be locked underneath us, that
 * loads asynchronously, and that we are only ever allowed to touch when the GM
 * ticked a box. The fixture carries one of each awkward case: a locked pack, a
 * pack of the wrong document type, a pack with nothing to convert, and a pack
 * that throws on write.
 */

import test from "node:test";
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Pack fixture                                 */
/* -------------------------------------------- */

const RATES = {
  pp: { conversion: 0.1 }, gp: { conversion: 1 }, ep: { conversion: 2 },
  sp: { conversion: 10 }, cp: { conversion: 100 },
  ct: { conversion: 1 }, cb: { conversion: 10 }, lb: { conversion: 100 }
};

/**
 * Build one stub pack.
 * @param {object} options
 * @param {string} options.collection
 * @param {string} options.documentName
 * @param {object[]} options.docs        Documents, used for both index and getDocuments.
 * @param {boolean} [options.locked]
 * @param {boolean} [options.failOnWrite]
 */
function makePack({ collection, documentName, docs, locked = false, failOnWrite = false }) {
  const pack = {
    collection,
    documentName,
    locked,
    metadata: { label: collection.split(".")[1] },
    indexFields: null,
    async getIndex({ fields } = {}) {
      pack.indexFields = fields;
      return docs.map(d => ({ _id: d._id, system: d.system }));
    },
    async getDocuments() {
      return docs.map(d => ({ ...d, id: d._id }));
    },
    documentClass: {
      updateDocuments: async (updates, context) => {
        if ( failOnWrite ) throw new Error(`${collection} is read-only`);
        pack.written = { updates, context };
        return updates;
      }
    }
  };
  return pack;
}

function stubPacks(packs) {
  globalThis.CONFIG = { DND5E: { currencies: RATES } };
  const collection = [...packs];
  collection.get = id => collection.find(p => p.collection === id);
  globalThis.game = {
    packs: collection,
    i18n: { localize: k => k, format: k => k },
    user: { isGM: true }
  };
  globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
  return collection;
}

/** The standard fixture: every case that matters, in one world. */
function standardPacks() {
  return stubPacks([
    makePack({
      collection: "world.athasian-npcs", documentName: "Actor",
      docs: [
        { _id: "npc1", system: { currency: { gp: 5, sp: 2 } } },
        { _id: "npc2", system: { currency: { ct: 3 } } },      // already ceramic
        { _id: "npc3", system: {} }                             // no currency field
      ]
    }),
    makePack({
      collection: "world.athasian-gear", documentName: "Item",
      docs: [
        { _id: "i1", system: { price: { value: 15, denomination: "gp" } } },
        { _id: "i2", system: { price: { value: 2, denomination: "ct" } } }, // converted
        { _id: "i3", system: {} }
      ]
    }),
    makePack({
      collection: "dnd5e.items", documentName: "Item", locked: true,
      docs: [{ _id: "l1", system: { price: { value: 1, denomination: "gp" } } }]
    }),
    makePack({
      collection: "world.notes", documentName: "JournalEntry",
      docs: [{ _id: "j1", system: {} }]
    }),
    makePack({
      collection: "world.empty-gear", documentName: "Item",
      docs: [{ _id: "e1", system: { price: { value: 4, denomination: "cb" } } }]
    })
  ]);
}

async function importPackMigration() {
  const url = new URL("../scripts/pack-migration.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
}

/* -------------------------------------------- */
/*  Scanning                                     */
/* -------------------------------------------- */

test("the scan offers unlocked Actor and Item packs only", async () => {
  standardPacks();
  const { scanPacks } = await importPackMigration();

  const { candidates } = await scanPacks();
  const ids = candidates.map(c => c.collection);

  assert.deepEqual(ids, ["world.athasian-npcs", "world.athasian-gear"]);
});

test("locked packs are counted, never offered", async () => {
  standardPacks();
  const { scanPacks } = await importPackMigration();

  const { candidates, locked } = await scanPacks();

  assert.equal(locked, 1);
  assert.ok(!candidates.some(c => c.collection === "dnd5e.items"));
});

test("a pack with nothing left to convert is not offered", async () => {
  standardPacks();
  const { scanPacks } = await importPackMigration();

  const { candidates } = await scanPacks();

  assert.ok(!candidates.some(c => c.collection === "world.empty-gear"),
    "everything in it is already ceramic");
});

test("the count is of documents needing work, not documents in the pack", async () => {
  standardPacks();
  const { scanPacks } = await importPackMigration();

  const { candidates } = await scanPacks();

  assert.equal(candidates.find(c => c.collection === "world.athasian-npcs").count, 1);
  assert.equal(candidates.find(c => c.collection === "world.athasian-gear").count, 1);
});

test("the scan reads the index rather than loading documents", async () => {
  // A pack with thousands of documents must not be fully loaded to render a
  // dialog. Requesting index fields is the whole reason this is affordable.
  const packs = standardPacks();
  const { scanPacks } = await importPackMigration();

  await scanPacks();

  const gear = packs.get("world.athasian-gear");
  assert.deepEqual(gear.indexFields, ["system.price", "system.currency"]);
});

test("each candidate carries the label the GM will read", async () => {
  standardPacks();
  const { scanPacks } = await importPackMigration();

  const { candidates } = await scanPacks();

  assert.equal(candidates[0].label, "athasian-npcs");
  assert.equal(candidates[0].documentName, "Actor");
});

/* -------------------------------------------- */
/*  Applying                                     */
/* -------------------------------------------- */

test("only the ticked packs are written to", async () => {
  const packs = standardPacks();
  const { applyPackMigration } = await importPackMigration();

  await applyPackMigration(["world.athasian-gear"]);

  assert.ok(packs.get("world.athasian-gear").written, "the ticked pack was written");
  assert.equal(packs.get("world.athasian-npcs").written, undefined,
    "an unticked pack must never be touched");
});

test("the write is routed to the pack, not the world", async () => {
  const packs = standardPacks();
  const { applyPackMigration } = await importPackMigration();

  await applyPackMigration(["world.athasian-gear"]);

  const { context } = packs.get("world.athasian-gear").written;
  assert.equal(context.pack, "world.athasian-gear");
});

test("item prices convert exactly", async () => {
  const packs = standardPacks();
  const { applyPackMigration } = await importPackMigration();

  await applyPackMigration(["world.athasian-gear"]);

  const { updates } = packs.get("world.athasian-gear").written;
  assert.equal(updates.length, 1, "only the gp item needed work");
  assert.deepEqual(updates[0], {
    _id: "i1", system: { price: { value: 15, denomination: "ct" } }
  });
});

test("actor currency converts exactly", async () => {
  const packs = standardPacks();
  const { applyPackMigration } = await importPackMigration();

  await applyPackMigration(["world.athasian-npcs"]);

  const { updates } = packs.get("world.athasian-npcs").written;
  assert.equal(updates.length, 1);
  assert.equal(updates[0]._id, "npc1");
  // 5 gp + 2 sp = 5.2 gp = 5 ct 2 cb.
  assert.equal(updates[0].system.currency.ct, 5);
  assert.equal(updates[0].system.currency.cb, 2);
  assert.equal(updates[0].system.currency.gp, 0, "the legacy coin is emptied");
});

test("a pack locked after the scan is refused, not written", async () => {
  const packs = standardPacks();
  const { applyPackMigration } = await importPackMigration();

  packs.get("world.athasian-gear").locked = true;
  const result = await applyPackMigration(["world.athasian-gear"]);

  assert.equal(packs.get("world.athasian-gear").written, undefined);
  assert.equal(result.packs, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /world\.athasian-gear/);
});

test("a pack that no longer exists is reported, not thrown", async () => {
  standardPacks();
  const { applyPackMigration } = await importPackMigration();

  const result = await applyPackMigration(["world.deleted"]);

  assert.equal(result.packs, 0);
  assert.equal(result.errors.length, 1);
});

test("one failing pack does not abort the rest of the run", async () => {
  const packs = stubPacks([
    makePack({
      collection: "world.bad", documentName: "Item", failOnWrite: true,
      docs: [{ _id: "b1", system: { price: { value: 3, denomination: "gp" } } }]
    }),
    makePack({
      collection: "world.good", documentName: "Item",
      docs: [{ _id: "g1", system: { price: { value: 7, denomination: "sp" } } }]
    })
  ]);
  const { applyPackMigration } = await importPackMigration();

  const result = await applyPackMigration(["world.bad", "world.good"]);

  assert.ok(packs.get("world.good").written, "the good pack still converted");
  assert.equal(result.packs, 1);
  assert.equal(result.documents, 1);
  assert.equal(result.errors.length, 1);
});

test("a second run finds nothing left to write", async () => {
  const packs = stubPacks([
    makePack({
      collection: "world.gear", documentName: "Item",
      docs: [{ _id: "i1", system: { price: { value: 15, denomination: "ct" } } }]
    })
  ]);
  const { applyPackMigration } = await importPackMigration();

  const result = await applyPackMigration(["world.gear"]);

  assert.equal(packs.get("world.gear").written, undefined, "no update proposed");
  assert.equal(result.documents, 0);
  assert.equal(result.errors.length, 0);
});

test("the document count reflects what the pack confirms, not what was submitted", async () => {
  // Foundry's updateDocuments resolves with the documents it actually wrote,
  // which is not guaranteed to match the payload one-for-one. Counting the
  // payload instead would overstate the result.
  const packs = stubPacks([
    makePack({
      collection: "world.partial", documentName: "Item",
      docs: [
        { _id: "p1", system: { price: { value: 1, denomination: "gp" } } },
        { _id: "p2", system: { price: { value: 2, denomination: "gp" } } }
      ]
    })
  ]);
  const pack = packs.get("world.partial");
  pack.documentClass.updateDocuments = async (updates, context) => {
    pack.written = { updates, context };
    return updates.slice(0, 1);
  };
  const { applyPackMigration } = await importPackMigration();

  const result = await applyPackMigration(["world.partial"]);

  assert.equal(result.documents, 1, "only the confirmed write should be counted");
});

/* -------------------------------------------- */
/*  Carried gear on Actor packs                  */
/* -------------------------------------------- */

/**
 * An Actor pack fixture whose documents carry `.items` and their own
 * `updateEmbeddedDocuments`, the way a real loaded Actor document does —
 * `getDocuments()` on a stub pack does not fabricate that surface on its own.
 */
function makeActorPack({ collection, actors, locked = false }) {
  const pack = {
    collection,
    documentName: "Actor",
    locked,
    metadata: { label: collection.split(".")[1] },
    async getIndex({ fields } = {}) {
      return actors.map(a => ({ _id: a.id, system: a.system }));
    },
    async getDocuments() {
      return actors;
    },
    documentClass: {
      updateDocuments: async (updates, context) => {
        pack.written = { updates, context };
        return updates;
      }
    }
  };
  return pack;
}

test("carried item prices on an Actor pack's documents convert alongside the purse", async () => {
  const npc = {
    id: "npc1", name: "Guard",
    system: { currency: { gp: 5 } },
    items: [{ id: "gear1", system: { price: { value: 15, denomination: "gp" } } }],
    async updateEmbeddedDocuments(_type, updates) {
      this.written = updates;
      return updates;
    }
  };
  stubPacks([makeActorPack({ collection: "world.npcs", actors: [npc] })]);
  const { applyPackMigration } = await importPackMigration();

  const result = await applyPackMigration(["world.npcs"]);

  assert.deepEqual(npc.written, [
    { _id: "gear1", system: { price: { value: 15, denomination: "ct" } } }
  ]);
  assert.equal(result.documents, 2, "the purse and the carried item both count");
});

test("carried gear converts even when the actor's own purse needs no work", async () => {
  const npc = {
    id: "npc1", name: "Templar",
    system: { currency: { ct: 12 } }, // already ceramic — nothing for the top-level write
    items: [{ id: "gear1", system: { price: { value: 4, denomination: "sp" } } }],
    async updateEmbeddedDocuments(_type, updates) {
      this.written = updates;
      return updates;
    }
  };
  const packs = stubPacks([makeActorPack({ collection: "world.npcs", actors: [npc] })]);
  const { applyPackMigration } = await importPackMigration();

  const result = await applyPackMigration(["world.npcs"]);

  assert.equal(packs.get("world.npcs").written, undefined, "no currency needed writing");
  assert.deepEqual(npc.written, [{ _id: "gear1", system: { price: { value: 4, denomination: "cb" } } }]);
  assert.equal(result.documents, 1);
  assert.equal(result.packs, 1, "the pack still counts as converted");
});

test("a failure converting one actor's carried items does not stop the rest of the pack", async () => {
  const bad = {
    id: "bad", name: "Bad",
    system: {},
    items: [{ id: "bad1", system: { price: { value: 1, denomination: "gp" } } }],
    async updateEmbeddedDocuments() {
      throw new Error("locked mid-conversion");
    }
  };
  const good = {
    id: "good", name: "Good",
    system: {},
    items: [{ id: "good1", system: { price: { value: 2, denomination: "gp" } } }],
    async updateEmbeddedDocuments(_type, updates) {
      this.written = updates;
      return updates;
    }
  };
  stubPacks([makeActorPack({ collection: "world.npcs", actors: [bad, good] })]);
  const { applyPackMigration } = await importPackMigration();

  const outcome = await applyPackMigration(["world.npcs"]);

  assert.deepEqual(good.written, [{ _id: "good1", system: { price: { value: 2, denomination: "ct" } } }]);
  assert.equal(outcome.errors.length, 1);
  assert.match(outcome.errors[0], /world\.npcs/);
});

test("scanPacks stays index-only: Actor pack scans do not request or load items", async () => {
  // The performance contract this feature depends on: the scan must never see
  // carried gear, only the currency-relevant index fields.
  const packs = stubPacks([
    makePack({
      collection: "world.npcs", documentName: "Actor",
      docs: [{ _id: "npc1", system: { currency: { gp: 5 } } }]
    })
  ]);
  const { scanPacks } = await importPackMigration();

  await scanPacks();

  assert.deepEqual(packs.get("world.npcs").indexFields, ["system.price", "system.currency"]);
});

/* -------------------------------------------- */
/*  Document type guard                          */
/* -------------------------------------------- */

test("applyPackMigration refuses a non-convertible document type, without throwing", async () => {
  // Unlike scanPacks, applyPackMigration can be called directly with whatever
  // collection id a caller hands it. A JournalEntry pack with a coincidental
  // `system.currency`-shaped field must not be treated as an Actor.
  const packs = stubPacks([
    makePack({
      collection: "world.notes", documentName: "JournalEntry",
      docs: [{ _id: "j1", system: { currency: { gp: 5 } } }]
    })
  ]);
  const { applyPackMigration } = await importPackMigration();

  const result = await applyPackMigration(["world.notes"]);

  assert.equal(packs.get("world.notes").written, undefined,
    "a JournalEntry pack must never be written to");
  assert.equal(result.packs, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /world\.notes/);
});

/* -------------------------------------------- */
/*  Dialog wiring                                */
/* -------------------------------------------- */

test("checkbox names carry no dots, so form data stays flat", async () => {
  // FormDataExtended expands `a.b` into {a: {b: ...}}. A pack id like
  // `world.athasian-gear` used as a field name would arrive nested and the
  // selection would read as empty.
  const { packCheckboxName } = await importPackMigration();

  const name = packCheckboxName(3);

  assert.ok(!name.includes("."), `${name} would be expanded by FormDataExtended`);
  assert.equal(name, "pack-3");
});

test("checkbox names are unique per index", async () => {
  const { packCheckboxName } = await importPackMigration();
  const names = [0, 1, 2].map(packCheckboxName);
  assert.equal(new Set(names).size, 3);
});
