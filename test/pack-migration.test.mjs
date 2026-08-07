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
