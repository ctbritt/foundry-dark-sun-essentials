# Coinage Conversion Macro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the currency conversion as a macro in a bundled compendium, and extend it to unlocked Actor and Item packs, opt-in per pack.

**Architecture:** A new `scripts/pack-migration.mjs` holds all compendium work — asynchronous, per-pack, index-based scanning — leaving `scripts/migration.mjs` as the synchronous world-data unit. The existing DialogV2 confirmation grows a checkbox list and drives both. A new LevelDB `Macro` pack, compiled from YAML at release time, gives the whole thing a front door.

**Tech Stack:** Foundry VTT v13/v14 ApplicationV2 + DialogV2, dnd5e 5.3.x, ES modules with no bundler, `node:test` for unit tests, `@foundryvtt/foundryvtt-cli` for pack compilation.

**Spec:** [docs/superpowers/specs/2026-08-06-coinage-macro-design.md](../specs/2026-08-06-coinage-macro-design.md)

## Global Constraints

- Foundry compatibility: minimum `13`, verified `14`. dnd5e minimum `5.3.0`, verified `5.3.3`.
- No bundler and no transpiler for `scripts/`. Files are shipped as authored and loaded as ES modules.
- Code style, matched to the existing files: 2-space indent, double quotes, semicolons, `if ( condition ) return;` with spaces inside the parens, JSDoc on every exported function, section banners (`/* ---- */`) between groups.
- No Foundry globals in `scripts/core/`. `scripts/pack-migration.mjs` is an adapter and may use `game`, `CONFIG`, and `ui`.
- Every user-facing string is an i18n key in `lang/en.json` under `dark-sun-essentials.migration.*` or `dark-sun-essentials.notify.*`. `test/i18n.test.mjs` fails on both missing and unused keys.
- Tests run with `npm test` (`node --test test/*.test.mjs`). No test framework beyond `node:test` and `node:assert/strict`.
- Compendium packs are never written to unless the GM ticked that specific pack in the dialog.
- Locked packs are never written to, under any circumstance.
- Commit after every task. Do not amend earlier commits.

---

### Task 1: Scan unlocked packs by index

Reading the index instead of the documents is what keeps the dialog from stalling on a large pack. `getIndex({fields})` returns partial documents with only the requested paths populated, which is enough to count candidates.

**Files:**
- Create: `scripts/pack-migration.mjs`
- Test: `test/pack-migration.test.mjs`

**Interfaces:**
- Consumes: `convertPrice`, `convertLegacyToCeramic`, `STANDARD_RATES` from `scripts/core/coinage.mjs` (all already exported).
- Produces:
  - `scanPacks(): Promise<{candidates: PackCandidate[], locked: number}>`
  - `PackCandidate = {collection: string, label: string, documentName: "Actor"|"Item", count: number}`
  - `entryNeedsConversion(entry: object, documentName: string, rates: object): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/pack-migration.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module .../scripts/pack-migration.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/pack-migration.mjs`:

```js
/**
 * Compendium migration: the same conversion, applied to packs.
 *
 * Separate from `migration.mjs` because packs behave differently in three ways
 * that matter. They load asynchronously, they can be locked underneath us
 * between the scan and the write, and they are opt-in: unlocked means the GM
 * is free to edit a pack, not that they asked us to rewrite it.
 *
 * The scan reads pack indexes rather than documents. A GM with a large
 * homebrew pack should not wait for every document to load just to see a
 * dialog.
 */

import { convertLegacyToCeramic, convertPrice, STANDARD_RATES } from "./core/coinage.mjs";
import { log } from "./compat.mjs";

/** Document types the conversion knows how to handle. */
const CONVERTIBLE = ["Actor", "Item"];

/** Index paths the scan needs. Requesting both for both types is harmless. */
const INDEX_FIELDS = ["system.price", "system.currency"];

/**
 * @typedef {object} PackCandidate
 * @property {string} collection    The pack's stable id, e.g. `world.athasian-gear`.
 * @property {string} label         What the GM sees in the sidebar.
 * @property {string} documentName  "Actor" or "Item".
 * @property {number} count         Documents in the pack with something to convert.
 */

/**
 * Does this document need rewriting?
 *
 * Both branches are idempotent by construction: `convertPrice` returns null for
 * any denomination outside the legacy five, and `convertLegacyToCeramic`
 * reports `converted: false` when there is no standard coin to fold in.
 *
 * @param {object} entry           An index entry or a full document.
 * @param {string} documentName    "Actor" or "Item".
 * @param {object} rates           `CONFIG.DND5E.currencies`, or a stand-in.
 * @returns {boolean}
 */
export function entryNeedsConversion(entry, documentName, rates = STANDARD_RATES) {
  if ( documentName === "Item" ) return convertPrice(entry?.system?.price) !== null;
  if ( documentName === "Actor" ) {
    if ( !entry?.system?.currency ) return false;
    return convertLegacyToCeramic(entry.system.currency, { rates }).converted;
  }
  return false;
}

/**
 * Read every unlocked Actor and Item pack and report what could be converted.
 * Writes nothing, and loads no documents.
 *
 * @returns {Promise<{candidates: PackCandidate[], locked: number}>}
 */
export async function scanPacks() {
  const candidates = [];
  let locked = 0;
  const rates = CONFIG.DND5E?.currencies ?? STANDARD_RATES;

  for ( const pack of game.packs ) {
    if ( !CONVERTIBLE.includes(pack.documentName) ) continue;
    if ( pack.locked ) {
      locked += 1;
      continue;
    }

    let count = 0;
    try {
      const index = await pack.getIndex({ fields: INDEX_FIELDS });
      for ( const entry of index ) {
        if ( entryNeedsConversion(entry, pack.documentName, rates) ) count += 1;
      }
    } catch ( error ) {
      // A pack that will not index is a pack we cannot safely offer. Say so in
      // the console and leave it out rather than showing a count of zero that
      // looks like "nothing to do".
      log("error", `Could not index ${pack.collection}:`, error);
      continue;
    }

    if ( !count ) continue;
    candidates.push({
      collection: pack.collection,
      label: pack.metadata?.label ?? pack.collection,
      documentName: pack.documentName,
      count
    });
  }

  return { candidates, locked };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, with the new tests included in the count.

- [ ] **Step 5: Commit**

```bash
git add scripts/pack-migration.mjs test/pack-migration.test.mjs
git commit -m "Scan unlocked packs by index, not by loading them"
```

---

### Task 2: Write the ticked packs

Documents are only loaded here, for packs the GM chose. Lock state is re-checked because a GM can lock a pack between the scan and the confirmation.

**Files:**
- Modify: `scripts/pack-migration.mjs`
- Test: `test/pack-migration.test.mjs`

**Interfaces:**
- Consumes: `entryNeedsConversion` and the module-level constants from Task 1.
- Produces:
  - `buildPackUpdates(documents: object[], documentName: string, rates: object): object[]`
  - `applyPackMigration(collections: string[]): Promise<{packs: number, documents: number, errors: string[]}>`

- [ ] **Step 1: Write the failing test**

Append to `test/pack-migration.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `applyPackMigration is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/pack-migration.mjs`:

```js
/* -------------------------------------------- */
/*  Applying                                     */
/* -------------------------------------------- */

/**
 * Turn loaded documents into update payloads.
 *
 * @param {object[]} documents
 * @param {string} documentName  "Actor" or "Item".
 * @param {object} rates         `CONFIG.DND5E.currencies`, or a stand-in.
 * @returns {object[]}           `updateDocuments` payloads. Empty when there is
 *                               nothing to do.
 */
export function buildPackUpdates(documents, documentName, rates = STANDARD_RATES) {
  const updates = [];

  for ( const doc of documents ) {
    if ( documentName === "Item" ) {
      const price = convertPrice(doc.system?.price);
      if ( price ) updates.push({ _id: doc.id ?? doc._id, system: { price } });
      continue;
    }

    if ( !doc.system?.currency ) continue;
    const result = convertLegacyToCeramic(doc.system.currency, { rates });
    if ( result.converted ) {
      updates.push({ _id: doc.id ?? doc._id, system: { currency: result.currency } });
    }
  }

  return updates;
}

/**
 * Convert the packs the GM ticked.
 *
 * Every pack is handled in its own try/catch: one unwritable pack must not
 * abort the rest and leave a half-converted set. Lock state is re-read here
 * rather than trusted from the scan, because the sidebar's padlock is one
 * click away and the dialog may have been open for a while.
 *
 * @param {string[]} collections  Pack collection ids, as ticked in the dialog.
 * @returns {Promise<{packs: number, documents: number, errors: string[]}>}
 */
export async function applyPackMigration(collections) {
  const result = { packs: 0, documents: 0, errors: [] };
  const rates = CONFIG.DND5E?.currencies ?? STANDARD_RATES;

  for ( const collection of collections ) {
    const pack = game.packs.get(collection);

    if ( !pack ) {
      result.errors.push(`${collection}: no longer present`);
      continue;
    }
    if ( pack.locked ) {
      result.errors.push(`${collection}: locked before the conversion ran`);
      continue;
    }

    try {
      const documents = await pack.getDocuments();
      const updates = buildPackUpdates(documents, pack.documentName, rates);
      if ( !updates.length ) continue;

      await pack.documentClass.updateDocuments(updates, { pack: collection, render: false });
      result.packs += 1;
      result.documents += updates.length;
    } catch ( error ) {
      log("error", `Converting ${collection} failed:`, error);
      result.errors.push(`${collection}: ${error.message}`);
    }
  }

  log("info", `Pack conversion complete: ${result.documents} documents in ${result.packs} packs.`);
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pack-migration.mjs test/pack-migration.test.mjs
git commit -m "Convert the packs the GM ticked, one failure at a time"
```

---

### Task 3: Offer the packs in the dialog

The dialog moves from `DialogV2.confirm` (a yes/no) to `DialogV2.wait` (a form), because it now has to return which boxes were ticked.

**Files:**
- Modify: `scripts/apps/migration-dialog.mjs`
- Modify: `lang/en.json`
- Modify: `test/i18n.test.mjs:74-78`
- Test: `test/pack-migration.test.mjs` (checkbox-name round trip)

**Interfaces:**
- Consumes: `scanPacks`, `applyPackMigration` from Task 1 and Task 2; `scanWorld`, `summarise`, `applyMigration` from `scripts/migration.mjs` (unchanged).
- Produces: `packCheckboxName(index: number): string` exported from `scripts/pack-migration.mjs`; `openMigrationDialog()` keeps its existing signature and return type.

- [ ] **Step 1: Write the failing test**

The checkbox naming is the one piece of dialog wiring that can be tested without a browser, and it is the piece most likely to break silently. Pack collection ids contain dots (`world.athasian-gear`), and `FormDataExtended` expands dotted names into nested objects — so the name must not be the id.

Append to `test/pack-migration.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `packCheckboxName is not a function`

- [ ] **Step 3: Add the helper**

Append to `scripts/pack-migration.mjs`:

```js
/* -------------------------------------------- */
/*  Dialog wiring                                */
/* -------------------------------------------- */

/**
 * The form field name for a pack's checkbox.
 *
 * Indexed rather than named after the pack: `FormDataExtended` expands dotted
 * field names into nested objects, and every pack id contains a dot.
 *
 * @param {number} index  Position in the candidate list.
 * @returns {string}
 */
export function packCheckboxName(index) {
  return `pack-${index}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Add the new copy**

In `lang/en.json`, replace the `migration.compendiums` line — packs are no longer categorically skipped, so the old copy is now wrong:

```json
  "dark-sun-essentials.migration.compendiums": "{count} compendium packs are left untouched. Compendium content is not converted, because the next system update would undo it.",
```

with:

```json
  "dark-sun-essentials.migration.packsIntro": "Unlocked compendium packs can be converted too. Tick only the packs you want rewritten — nothing here is selected by default.",
  "dark-sun-essentials.migration.packRow": "{label} &mdash; {count} documents",
  "dark-sun-essentials.migration.packsLocked": "{count} locked packs were skipped. System packs are locked for good reason: the next system update would undo anything written to them.",
```

and add to the `notify` group:

```json
  "dark-sun-essentials.notify.packsDone": "Converted {documents} documents across {packs} compendium packs.",
```

- [ ] **Step 6: Update the i18n key inventory**

In `test/i18n.test.mjs`, the `migration` array at lines 74-78 lists keys the static scan cannot see. Replace `"compendiums"` with the three new keys, and add the new notify key:

```js
  const migration = [
    "title", "intro", "introRemoval", "countActors", "countItems", "countTokens",
    "rates", "packsIntro", "packRow", "packsLocked", "skippedCoins", "remainder",
    "warning", "confirm", "cancel", "keepAnyway", "removeAnyway", "revert",
    "errorsTitle", "errorsIntro", "close"
  ];
  const notify = [
    "incompatible", "removalNeedsCeramic", "nothingToConvert", "migrationDone",
    "migrationPartial", "packsDone", "removalReverted", "untestedSystem"
  ];
```

- [ ] **Step 7: Run the tests to see the unused-key check fail**

Run: `npm test 2>&1 | tail -20`
Expected: PASS. (`migration.*` and `notify.*` are exempt from the unused-key check by the `dynamic` regex at `test/i18n.test.mjs:95`, and the inventory test now names every key that exists.) If it fails, the inventory and `en.json` disagree — fix the mismatch before continuing.

- [ ] **Step 8: Rewrite the dialog**

In `scripts/apps/migration-dialog.mjs`, replace the imports at the top:

```js
import { MODULE_ID, SETTINGS } from "../core/constants.mjs";
import { applyMigration, scanWorld, summarise } from "../migration.mjs";
import { applyPackMigration, packCheckboxName, scanPacks } from "../pack-migration.mjs";
import { log } from "../compat.mjs";

const { DialogV2 } = foundry.applications.api;

/** v13 namespaced it; the bare global is deprecated but still present. */
const FormData = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;
```

Replace the whole of `openMigrationDialog` with:

```js
/**
 * Scan the world, show the GM what will change, and migrate if they agree.
 *
 * @param {object} [options]
 * @param {boolean} [options.removalPending]  True when this was triggered by
 *   enabling the removal setting, which changes the copy and the stakes:
 *   declining reverts the setting rather than merely cancelling.
 * @returns {Promise<boolean>}  Whether the migration ran.
 */
export async function openMigrationDialog({ removalPending = false } = {}) {
  const plan = scanWorld();
  const summary = summarise(plan);
  const { candidates, locked } = await scanPacks();

  if ( summary.empty && !candidates.length ) {
    ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.notify.nothingToConvert`));
    return false;
  }

  const selection = await DialogV2.wait({
    window: { title: `${MODULE_ID}.migration.title`, icon: "fa-solid fa-coins" },
    position: { width: 520 },
    content: buildContent(summary, candidates, locked, removalPending),
    buttons: [
      {
        action: "convert",
        icon: "fa-solid fa-right-left",
        label: `${MODULE_ID}.migration.confirm`,
        callback: (event, button) => readSelection(button.form, candidates)
      },
      {
        action: "cancel",
        icon: "fa-solid fa-xmark",
        label: `${MODULE_ID}.migration.cancel`,
        default: true
      }
    ],
    rejectClose: false,
    modal: true
  });

  // `cancel`, the close button, and Escape all land here.
  if ( !Array.isArray(selection) ) {
    log("info", "Migration declined.");
    return false;
  }

  const result = await applyMigration(plan);
  const packResult = selection.length
    ? await applyPackMigration(selection)
    : { packs: 0, documents: 0, errors: [] };

  result.errors.push(...packResult.errors);
  await reportResult(result, packResult);
  return true;
}

/* -------------------------------------------- */

/**
 * Read the ticked packs back out of the form.
 * @param {HTMLFormElement} form
 * @param {import("../pack-migration.mjs").PackCandidate[]} candidates
 * @returns {string[]}  Collection ids, in candidate order.
 */
function readSelection(form, candidates) {
  const data = new FormData(form).object;
  return candidates
    .filter((_candidate, index) => data[packCheckboxName(index)] === true)
    .map(candidate => candidate.collection);
}
```

- [ ] **Step 9: Render the pack rows**

In the same file, replace `buildContent` with:

```js
/**
 * @param {ReturnType<import("../migration.mjs").summarise>} summary
 * @param {import("../pack-migration.mjs").PackCandidate[]} candidates
 * @param {number} locked
 * @param {boolean} removalPending
 * @returns {string}
 */
function buildContent(summary, candidates, locked, removalPending) {
  const t = (key, data) => game.i18n.format(`${MODULE_ID}.migration.${key}`, data ?? {});
  const parts = [`<p>${t(removalPending ? "introRemoval" : "intro")}</p>`];

  parts.push(`<ul class="dark-sun-migration-summary">
    <li>${t("countActors", { count: summary.actors })}</li>
    <li>${t("countItems", { count: summary.items })}</li>
    <li>${t("countTokens", { count: summary.tokens })}</li>
  </ul>`);

  parts.push(`<p class="notes">${t("rates")}</p>`);

  if ( candidates.length ) {
    const rows = candidates.map((candidate, index) => `<label class="dark-sun-pack-row">
      <input type="checkbox" name="${packCheckboxName(index)}">
      <span>${t("packRow", {
        label: foundry.utils.escapeHTML?.(candidate.label) ?? candidate.label,
        count: candidate.count
      })}</span>
    </label>`).join("");
    parts.push(`<p class="notes">${t("packsIntro")}</p>
      <div class="dark-sun-pack-list">${rows}</div>`);
  }

  if ( locked ) parts.push(`<p class="notes">${t("packsLocked", { count: locked })}</p>`);

  if ( summary.skippedCoins.length ) {
    parts.push(`<p class="notes warning">${t("skippedCoins", {
      coins: summary.skippedCoins.join(", ")
    })}</p>`);
  }
  if ( summary.remainder > 0 ) {
    parts.push(`<p class="notes warning">${t("remainder", {
      value: summary.remainder.toFixed(2)
    })}</p>`);
  }

  // Shown whenever packs are on offer, not only on the removal path: pack
  // writes cannot be undone from inside Foundry either.
  if ( removalPending || candidates.length ) {
    parts.push(`<p class="notification warning">${t("warning")}</p>`);
  }

  return parts.join("");
}
```

- [ ] **Step 10: Report both halves**

Replace `reportResult` in the same file:

```js
/**
 * @param {{actors: number, items: number, tokens: number, errors: string[]}} result
 * @param {{packs: number, documents: number}} packResult
 */
async function reportResult(result, packResult) {
  if ( !result.errors.length ) {
    ui.notifications?.info(game.i18n.format(`${MODULE_ID}.notify.migrationDone`, result));
    if ( packResult.packs ) {
      ui.notifications?.info(game.i18n.format(`${MODULE_ID}.notify.packsDone`, packResult));
    }
    return;
  }

  ui.notifications?.error(game.i18n.format(`${MODULE_ID}.notify.migrationPartial`, {
    count: result.errors.length
  }), { permanent: true });

  await DialogV2.prompt({
    window: { title: `${MODULE_ID}.migration.errorsTitle`, icon: "fa-solid fa-triangle-exclamation" },
    content: `<p>${game.i18n.localize(`${MODULE_ID}.migration.errorsIntro`)}</p>
      <ul>${result.errors.map(e => `<li>${foundry.utils.escapeHTML?.(e) ?? e}</li>`).join("")}</ul>`,
    ok: { label: `${MODULE_ID}.migration.close` },
    rejectClose: false
  });
}
```

- [ ] **Step 11: Style the pack list**

Append to `styles/dark-sun-essentials.css`:

```css
.dark-sun-pack-list {
  max-height: 12rem;
  overflow-y: auto;
  margin: 0.5rem 0;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border-light-tertiary, #7a7971);
  border-radius: 3px;
}

.dark-sun-pack-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.15rem 0;
  cursor: pointer;
}
```

- [ ] **Step 12: Run the full suite**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, all tests. The dialog itself is not unit-tested — it renders in a browser and is verified on the Pi in Task 5.

- [ ] **Step 13: Commit**

```bash
git add scripts/apps/migration-dialog.mjs scripts/pack-migration.mjs lang/en.json test/i18n.test.mjs test/pack-migration.test.mjs styles/dark-sun-essentials.css
git commit -m "Offer unlocked packs in the migration dialog, unticked"
```

---

### Task 4: Ship the macro in a compendium

This is where the repo gains a build step. Keep it contained: one dev dependency, one script, one gitignored output directory.

**Files:**
- Create: `packs/src/dark-sun-macros/convert-to-athasian-coinage.yml`
- Create: `tools/build-packs.mjs`
- Modify: `package.json`
- Modify: `module.json`
- Modify: `.gitignore`
- Modify: `scripts/main.mjs:28`
- Modify: `test/manifest.test.mjs`
- Modify: `.github/workflows/` (the release workflow)

**Interfaces:**
- Consumes: `openMigrationDialog` from Task 3, already on the module API.
- Produces: `packs/dark-sun-macros/` (LevelDB, gitignored) declared in `module.json` as `packs[0]`.

- [ ] **Step 1: Write the failing test**

Append to `test/manifest.test.mjs`, in a new section before the world-script section:

```js
/* -------------------------------------------- */
/*  Compendium packs                             */
/* -------------------------------------------- */

test("the macro pack is declared", () => {
  const pack = manifest.packs?.find(p => p.name === "dark-sun-macros");
  assert.ok(pack, "module.json declares no dark-sun-macros pack");
  assert.equal(pack.type, "Macro");
  assert.equal(pack.path, "packs/dark-sun-macros");
});

test("the macro pack is GM-only", () => {
  // The macro rewrites every price and purse in the world. A player who can
  // see it in the sidebar is a player who can run it.
  const pack = manifest.packs.find(p => p.name === "dark-sun-macros");
  assert.equal(pack.ownership.PLAYER, "NONE");
  assert.equal(pack.ownership.ASSISTANT, "NONE");
});

test("every declared pack has compilable source", () => {
  // The built LevelDB directory is gitignored — it only exists after
  // `npm run build:packs`. The source is what must be present in a clone.
  for ( const pack of manifest.packs ?? [] ) {
    const source = join(ROOT, "packs", "src", pack.name);
    assert.ok(existsSync(source), `${pack.name} has no source at packs/src/${pack.name}`);
  }
});

test("the macro calls an API the module actually exposes", () => {
  // The macro is a shim over module.api. If the API is renamed and the macro
  // is not, a GM gets "openMigrationDialog is not a function" and no clue why.
  const source = read("packs/src/dark-sun-macros/convert-to-athasian-coinage.yml");
  const called = [...source.matchAll(/api\.(\w+)\(/g)].map(m => m[1]);
  assert.ok(called.length, "the macro calls nothing");
  const exposed = read("scripts/main.mjs");
  for ( const fn of called ) {
    assert.ok(new RegExp(`\\b${fn}\\b`).test(exposed), `main.mjs does not expose ${fn}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — "module.json declares no dark-sun-macros pack"

- [ ] **Step 3: Write the macro source**

Create `packs/src/dark-sun-macros/convert-to-athasian-coinage.yml`:

```yaml
_id: dseConvertCoin01
name: Convert to Athasian Coinage
type: script
scope: global
author: null
img: modules/dark-sun-essentials/icons/ceramic-token.svg
command: |
  // Dark Sun Essentials — open the currency conversion dialog.
  //
  // Scans the world (and any unlocked compendium packs you tick) for coin and
  // prices held in standard denominations, shows you the totals, and converts
  // only after you confirm. Nothing is written until you press Convert.
  const module = game.modules.get("dark-sun-essentials");
  if ( !module?.active ) {
    ui.notifications.error("Dark Sun Essentials is not active in this world.");
  } else {
    await module.api.openMigrationDialog();
  }
folder: null
sort: 0
ownership:
  default: 0
flags: {}
_key: '!macros!dseConvertCoin01'
```

- [ ] **Step 4: Write the build script**

Create `tools/build-packs.mjs`:

```js
/**
 * Compile `packs/src/<name>/*.yml` into the LevelDB packs Foundry loads.
 *
 * The sources are YAML so the macro body is reviewable in a diff. The built
 * packs are binary and gitignored; this runs before packaging a release, and
 * before deploying to a test install.
 *
 * Usage: npm run build:packs
 */

import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "packs", "src");

const names = readdirSync(SOURCE).filter(name => statSync(join(SOURCE, name)).isDirectory());

if ( !names.length ) {
  console.error("No pack sources found under packs/src.");
  process.exit(1);
}

for ( const name of names ) {
  await compilePack(join(SOURCE, name), join(ROOT, "packs", name), { yaml: true, log: true });
}

console.log(`Built ${names.length} pack(s).`);
```

- [ ] **Step 5: Wire up the tooling**

In `package.json`, add the script and the dev dependency:

```json
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "build:packs": "node tools/build-packs.mjs"
  },
  "devDependencies": {
    "@foundryvtt/foundryvtt-cli": "^1.0.4"
  }
```

Then install:

```bash
npm install
```

In `.gitignore`, add the built output below the existing `module.zip` line.
`node_modules/` is already there. The negation must follow the exclusion, and
the exclusion must not have a trailing slash — git cannot re-include anything
inside a directory it has been told to ignore wholesale:

```
packs/*
!packs/src
```

In `module.json`, add the `packs` array after `languages`:

```json
  "packs": [
    {
      "name": "dark-sun-macros",
      "label": "Dark Sun Essentials: Macros",
      "path": "packs/dark-sun-macros",
      "type": "Macro",
      "ownership": {
        "PLAYER": "NONE",
        "ASSISTANT": "NONE"
      }
    }
  ],
```

- [ ] **Step 6: Build the pack and confirm it compiles**

Run:

```bash
npm run build:packs && ls packs/dark-sun-macros
```

Expected: LevelDB files (`CURRENT`, `LOCK`, `MANIFEST-*`, `*.log`) in `packs/dark-sun-macros`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 8: Build packs in the release workflow**

A release whose `module.json` declares a pack that is not in the zip fails to load with a console error and no dialog, so both halves of this matter.

In `.github/workflows/release.yml`, add a build step between "Check the tag matches module.json" and "Pin the manifest and download URLs":

```yaml
      # The compendium packs are LevelDB directories built from the YAML under
      # packs/src. They are gitignored, so the checkout does not contain them
      # and the zip below would ship a manifest declaring a pack that is not
      # there — which Foundry reports as a load failure, not a missing macro.
      - name: Build compendium packs
        run: |
          npm ci
          npm run build:packs
```

Then add `packs/` to the zip list in the "Package" step, after `icons/`:

```yaml
      - name: Package
        run: |
          zip -r module.zip \
            module.json \
            scripts/ \
            styles/ \
            templates/ \
            lang/ \
            icons/ \
            packs/ \
            README.md \
            CHANGELOG.md \
            LICENSE
          unzip -l module.zip
```

Because `packs/src` is gitignored-but-present in the build (it is checked in), the zip would also carry the YAML sources. That is harmless — a few KB Foundry ignores — and excluding it costs a second `zip -d` invocation. Leave it.

In `.github/workflows/ci.yml`, the comment above the Test step now states something false — there is a lockfile and a build step. Replace that comment block with:

```yaml
      # The tests need no dependencies: they run on node's built-in runner and
      # stub Foundry themselves. The compendium packs are deliberately NOT built
      # here — test/manifest.test.mjs asserts the pack *source* exists, not the
      # built artifact, so CI catches a missing source without paying for a
      # build on every push.
```

- [ ] **Step 9: Commit**

```bash
git add packs/src tools/build-packs.mjs package.json package-lock.json module.json .gitignore test/manifest.test.mjs .github
git commit -m "Ship the conversion as a macro in a bundled compendium"
```

---

### Task 5: Documentation, changelog, and verification on the Pi

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `module.json` (version)
- Modify: `package.json` (version)
- Modify: `world-script/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Bump the version**

Set `"version": "1.3.0"` in both `module.json` and `package.json`. `test/manifest.test.mjs` asserts they agree and that `CHANGELOG.md` has a matching heading, so all three move together.

- [ ] **Step 2: Write the changelog entry**

Add to the top of `CHANGELOG.md`, matching the existing entry format:

```markdown
## 1.3.0

### Added
- A **Convert to Athasian Coinage** macro, shipped in the module's compendium.
  v1.2.0 removed the settings window that held this button, leaving the
  conversion reachable only by arming the removal toggle.
- The conversion now offers unlocked compendium packs. Actor packs get their
  currency converted, item packs get their prices. Every pack is a separate
  checkbox and none are ticked by default.

### Changed
- The migration dialog warns about backups whenever packs are on offer, not
  only when the standard coins are being removed.
```

- [ ] **Step 3: Document the macro in the README**

Find the section covering currency conversion and add the macro as the primary route, keeping the API line for anyone scripting it:

```markdown
### Converting existing money

Open **Compendiums → Dark Sun Essentials: Macros** and run **Convert to
Athasian Coinage**. The dialog shows what it found before it writes anything:
actors holding standard coin, items priced in it, unlinked tokens on scenes,
and any unlocked compendium packs it could also convert.

Compendium packs are opt-in, one checkbox each, and nothing is ticked by
default. Locked packs are counted and skipped — including every system pack,
which the next dnd5e update would overwrite anyway.

The conversion is exact and idempotent: 1 pp → 10 ct, 1 gp → 1 ct, 1 ep → 5 cb,
1 sp → 1 cb, 1 cp → 1 lb. Running it twice finds nothing to do the second time.
It cannot be undone from inside Foundry, so back the world up first.

From a script, the same dialog is:

```js
game.modules.get("dark-sun-essentials").api.openMigrationDialog();
```
```

- [ ] **Step 4: Note the world-script limitation**

In `world-script/README.md`, under *What you give up*, add a fourth bullet:

```markdown
- **Compendium conversion.** A world script cannot ship a compendium, so
  `convertCurrency()` here covers world data only. The module's macro also
  offers to convert unlocked compendium packs.
```

- [ ] **Step 5: Add the build step to the deploy note**

In `CLAUDE.md`, the deploy section now needs a build first — the rsync copies `packs/dark-sun-macros`, which does not exist in a fresh clone. Add before the rsync command:

```markdown
Build the compendium packs first — they are gitignored, so a fresh clone has no
`packs/dark-sun-macros` and the module will fail to load with a missing-pack
error:

```
npm run build:packs
```
```

and add `--exclude 'packs/src'` and `--exclude tools` to the rsync command's exclude list.

- [ ] **Step 6: Run the full suite**

Run: `npm test 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add README.md CHANGELOG.md module.json package.json world-script/README.md CLAUDE.md
git commit -m "1.3.0: document the conversion macro and pack support"
```

- [ ] **Step 8: Deploy to the Pi**

```bash
npm run build:packs && rsync -av --delete --exclude '.git*' --exclude .claude --exclude test --exclude docs --exclude tools --exclude 'packs/src' --exclude node_modules --exclude package.json --exclude CLAUDE.md --exclude .DS_Store ./ chris@raspberrypi.minskin-chinstrap.ts.net:foundryuserdata/Data/modules/dark-sun-essentials/
```

Then restart:

```bash
ssh chris@raspberrypi.minskin-chinstrap.ts.net pm2 restart foundry
```

- [ ] **Step 9: Verify in a browser, because nothing above proves the dialog works**

Load the world on the Pi install as GM and check each of these:

1. **Compendiums → Dark Sun Essentials: Macros** exists and contains the macro. A missing pack means the zip/rsync excluded `packs/`.
2. Running the macro opens the dialog with world counts filled in.
3. Unlocked world packs appear as unticked checkboxes with plausible counts. Locked packs do not appear, and the skipped-count line names them.
4. Pressing **Cancel** writes nothing — re-run and confirm the counts are unchanged.
5. Ticking one pack and pressing **Convert** rewrites that pack and no other. Check a second unlocked pack is untouched.
6. Re-running finds nothing to convert in the pack just done — this is the idempotency check, and it is the one that proves the conversion is safe to repeat.
7. A player-role login cannot see the macro compendium.

Report each as pass or fail. Do not describe this feature as working until steps 1-7 have actually been performed in a browser.

---

## Notes for the implementer

**What must not change.** `scripts/core/coinage.mjs` and `scripts/migration.mjs` are correct and covered by 133 existing tests. This plan adds a parallel unit for packs; it does not refactor either file. If a task seems to require editing them, stop and re-read the spec.

**Why packs are re-checked for locks at apply time.** The dialog can sit open indefinitely. The sidebar padlock is one click. Trusting the scan means a write attempt against a locked pack, which throws a Foundry error the GM cannot act on.

**Why the macro is a shim.** A GM who imports the macro into their world owns that copy forever — module updates cannot reach it. Keeping the body to an API call means bug fixes land in the module, where they do reach them.
