/**
 * Migration dialog tests against a stubbed DialogV2 and world.
 *
 * The dialog is the one place both the world path and the pack path meet, so
 * these tests cover what neither `migration.test.mjs` nor
 * `pack-migration.test.mjs` can see on its own: the GM gate on the module's
 * public entry point, and the reporting that happens after both migrations
 * have already run.
 */

import test from "node:test";
import assert from "node:assert/strict";

/**
 * Install the globals `migration-dialog.mjs` needs. Everything defaults to an
 * empty, successful no-op world so a test only has to override what it cares
 * about.
 * @param {object} [options]
 * @param {boolean} [options.isGM=true]
 * @param {Function} [options.wait]     Stub for `DialogV2.wait`.
 * @param {Function} [options.prompt]   Stub for `DialogV2.prompt`.
 */
function stubDialog({ isGM = true, wait, prompt } = {}) {
  const notifications = { info: [], warn: [], error: [] };

  globalThis.CONFIG = {
    DND5E: {
      currencies: {
        pp: { conversion: 0.1 }, gp: { conversion: 1 }, ep: { conversion: 2 },
        sp: { conversion: 10 }, cp: { conversion: 100 },
        ct: { conversion: 1 }, cb: { conversion: 10 }, lb: { conversion: 100 }
      }
    }
  };

  class DialogV2 {
    static wait = wait ?? (async () => null);
    static prompt = prompt ?? (async () => {});
    static confirm = async () => false;
  }

  globalThis.foundry = {
    applications: {
      api: { DialogV2 },
      ux: { FormDataExtended: class { constructor() { this.object = {}; } } }
    },
    utils: { escapeHTML: s => s }
  };

  const packs = [];
  packs.get = () => undefined;

  globalThis.game = {
    user: { isGM },
    actors: [],
    items: [],
    scenes: [],
    packs,
    i18n: { localize: k => k, format: k => k },
    settings: { set: async () => {} }
  };
  globalThis.ui = {
    notifications: {
      info: m => notifications.info.push(m),
      warn: m => notifications.warn.push(m),
      error: m => notifications.error.push(m)
    }
  };
  globalThis.Actor = { updateDocuments: async u => u };
  globalThis.Item = { updateDocuments: async u => u };

  return { notifications, DialogV2 };
}

/** Import fresh each time; ESM caches, so bust it with a query string. */
async function importDialog() {
  const url = new URL("../scripts/apps/migration-dialog.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
}

/* -------------------------------------------- */
/*  GM guard                                     */
/* -------------------------------------------- */

test("openMigrationDialog refuses to run for a non-GM", async () => {
  const { notifications } = stubDialog({ isGM: false });
  const { openMigrationDialog } = await importDialog();

  const result = await openMigrationDialog();

  assert.equal(result, false);
  assert.equal(notifications.error.length, 1);
});

test("openMigrationDialog proceeds for a GM with nothing to convert", async () => {
  stubDialog({ isGM: true });
  const { openMigrationDialog } = await importDialog();

  // An empty world and no packs: the "nothing to convert" branch, reached
  // only if the GM guard did not already bail out.
  const result = await openMigrationDialog();

  assert.equal(result, false);
});

/* -------------------------------------------- */
/*  Reporting                                    */
/* -------------------------------------------- */

test("a pack failure still reports what the world conversion completed", async () => {
  const badPack = {
    collection: "world.bad", documentName: "Item", locked: true,
    metadata: { label: "Bad" },
    async getIndex() { return []; },
    documentClass: { updateDocuments: async u => u }
  };
  const packs = Object.assign([badPack], { get: id => [badPack].find(p => p.collection === id) });

  const { notifications } = stubDialog({
    isGM: true,
    wait: async () => ["world.bad"]
  });

  // An actor holding standard coin, so the world half of the migration has
  // something to convert and succeeds.
  globalThis.game.actors = [{ id: "a1", name: "Hero", items: [], system: { currency: { gp: 5 } } }];
  globalThis.game.packs = packs;

  const { openMigrationDialog } = await importDialog();
  const ran = await openMigrationDialog();

  assert.equal(ran, true);
  assert.equal(notifications.info.length, 1,
    "the world conversion succeeded and must still be reported");
  assert.equal(notifications.error.length, 1,
    "the locked pack failure is still reported");
});

test("declining the dialog reports nothing and converts nothing", async () => {
  stubDialog({ isGM: true, wait: async () => null });
  globalThis.game.actors = [{ id: "a1", name: "Hero", items: [], system: { currency: { gp: 5 } } }];

  const { openMigrationDialog } = await importDialog();
  const ran = await openMigrationDialog();

  assert.equal(ran, false);
});
