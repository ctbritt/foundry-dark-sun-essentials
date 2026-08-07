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
