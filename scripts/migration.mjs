/**
 * World data migration: legacy coin into ceramic.
 *
 * Two phases, always. `scanWorld()` reads and proposes; `applyMigration()`
 * writes. The dialog shows the scan before anything is committed, because
 * removing the standard currencies drops them from the actor schema — any
 * balance still sitting in them afterwards is unreadable.
 *
 * This file is world data only: actors, their carried items, sidebar items,
 * and unlinked tokens. Compendium packs are handled separately, by
 * `pack-migration.mjs` — they load asynchronously, can be locked underneath
 * us between the scan and the write, and are opt-in per pack rather than
 * swept in bulk. Locked packs are still never written, here or there: system
 * packs are locked for good reason, and rewriting one would be undone by the
 * next system update.
 */

import { LEGACY_KEYS, MODULE_ID } from "./core/constants.mjs";
import { convertLegacyToCeramic, convertPrice } from "./core/coinage.mjs";
import { log } from "./compat.mjs";

/**
 * @typedef {object} MigrationPlan
 * @property {object[]} actors        `Actor.updateDocuments` payloads.
 * @property {object[]} items         World `Item.updateDocuments` payloads.
 * @property {Map<string, object[]>} embedded  Actor id -> embedded item updates.
 * @property {Map<string, object[]>} synthetic Scene id -> unlinked token updates.
 * @property {number} remainder       Fractional value that would not divide into a lead bead.
 * @property {string[]} skippedCoins  Coins whose conversion rate was unusable.
 * @property {number} compendiums     Count of Actor/Item packs in the world;
 *   not read or written by this file. See `pack-migration.mjs`.
 */

/**
 * Read the world and propose changes. Writes nothing.
 * @returns {MigrationPlan}
 */
export function scanWorld() {
  /** @type {MigrationPlan} */
  const plan = {
    actors: [],
    items: [],
    embedded: new Map(),
    synthetic: new Map(),
    remainder: 0,
    skippedCoins: [],
    compendiums: 0
  };
  const skipped = new Set();
  const rates = CONFIG.DND5E.currencies;

  const noteCurrency = (doc, into, id) => {
    if ( !doc?.system?.currency ) return false;
    const result = convertLegacyToCeramic(doc.system.currency, { rates });
    result.skipped.forEach(k => skipped.add(k));
    plan.remainder += result.remainder;
    if ( !result.converted ) return false;
    into.push({ _id: id ?? doc.id, system: { currency: result.currency } });
    return true;
  };

  const collectItemPrices = collection => {
    const updates = [];
    for ( const item of collection ) {
      const price = convertPrice(item.system?.price);
      if ( price ) updates.push({ _id: item.id, system: { price } });
    }
    return updates;
  };

  // World actors, and the items they carry.
  for ( const actor of game.actors ) {
    noteCurrency(actor, plan.actors);
    const itemUpdates = collectItemPrices(actor.items);
    if ( itemUpdates.length ) plan.embedded.set(actor.id, itemUpdates);
  }

  // World items in the sidebar.
  plan.items = collectItemPrices(game.items);

  // Unlinked tokens hold their own actor data as a delta on the scene.
  for ( const scene of game.scenes ) {
    const updates = [];
    for ( const token of scene.tokens ) {
      if ( token.actorLink || !token.actor ) continue;
      const currencyUpdates = [];
      if ( noteCurrency(token.actor, currencyUpdates, token.id) ) {
        updates.push({ _id: token.id, delta: { system: currencyUpdates[0].system } });
      }
    }
    if ( updates.length ) plan.synthetic.set(scene.id, updates);
  }

  plan.compendiums = game.packs.filter(p => ["Actor", "Item"].includes(p.documentName)).length;
  plan.skippedCoins = [...skipped];
  return plan;
}

/**
 * Human-readable totals for the confirmation dialog.
 * @param {MigrationPlan} plan
 * @returns {{actors: number, items: number, tokens: number, compendiums: number,
 *           remainder: number, skippedCoins: string[], empty: boolean}}
 */
export function summarise(plan) {
  const embedded = [...plan.embedded.values()].reduce((n, u) => n + u.length, 0);
  const tokens = [...plan.synthetic.values()].reduce((n, u) => n + u.length, 0);
  const items = plan.items.length + embedded;
  return {
    actors: plan.actors.length,
    items,
    tokens,
    compendiums: plan.compendiums,
    remainder: plan.remainder,
    skippedCoins: plan.skippedCoins,
    empty: !plan.actors.length && !items && !tokens
  };
}

/**
 * Commit a plan.
 *
 * Failures are caught per collection so one bad document cannot abort the rest
 * of the run and leave the world half-converted.
 *
 * @param {MigrationPlan} plan
 * @returns {Promise<{actors: number, items: number, tokens: number, errors: string[]}>}
 */
export async function applyMigration(plan) {
  const errors = [];
  let actors = 0;
  let items = 0;
  let tokens = 0;

  const attempt = async (label, fn) => {
    try {
      return await fn();
    } catch ( error ) {
      log("error", `${label} failed:`, error);
      errors.push(`${label}: ${error.message}`);
      return null;
    }
  };

  if ( plan.actors.length ) {
    const done = await attempt("Actor currency", () =>
      Actor.updateDocuments(plan.actors, { render: false }));
    actors = done?.length ?? 0;
  }

  if ( plan.items.length ) {
    const done = await attempt("World item prices", () =>
      Item.updateDocuments(plan.items, { render: false }));
    items += done?.length ?? 0;
  }

  for ( const [actorId, updates] of plan.embedded ) {
    const actor = game.actors.get(actorId);
    if ( !actor ) continue;
    const done = await attempt(`Carried item prices on ${actor.name}`, () =>
      actor.updateEmbeddedDocuments("Item", updates, { render: false }));
    items += done?.length ?? 0;
  }

  for ( const [sceneId, updates] of plan.synthetic ) {
    const scene = game.scenes.get(sceneId);
    if ( !scene ) continue;
    const done = await attempt(`Unlinked tokens on ${scene.name}`, () =>
      scene.updateEmbeddedDocuments("Token", updates, { render: false }));
    tokens += done?.length ?? 0;
  }

  log("info", `Migration complete: ${actors} actors, ${items} items, ${tokens} tokens.`);
  return { actors, items, tokens, errors };
}

/**
 * Scan and commit in one step, reporting to the GM.
 * @returns {Promise<{actors: number, items: number, tokens: number, errors: string[]}|null>}
 */
export async function runMigration() {
  const plan = scanWorld();
  const summary = summarise(plan);

  if ( summary.empty ) {
    ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.notify.nothingToConvert`));
    return null;
  }

  const result = await applyMigration(plan);

  if ( result.errors.length ) {
    ui.notifications?.error(game.i18n.format(`${MODULE_ID}.notify.migrationPartial`, {
      count: result.errors.length
    }), { permanent: true });
  } else {
    ui.notifications?.info(game.i18n.format(`${MODULE_ID}.notify.migrationDone`, {
      actors: result.actors, items: result.items, tokens: result.tokens
    }));
  }
  return result;
}

/** The coins the migration reads from, exposed for the dialog's copy. */
export const CONVERTED_COINS = LEGACY_KEYS;
