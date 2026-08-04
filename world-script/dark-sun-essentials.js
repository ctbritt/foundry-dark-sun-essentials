/**
 * Dark Sun Essentials — world script edition.
 *
 * Everything the module does, in one file with no manifest, no settings UI and
 * no assets on disk. Drop it in `worlds/<your-world>/scripts/` and list it in
 * `world.json` under `"scripts"`. Toggle features with the FEATURES block below;
 * a change takes effect on the next world reload.
 *
 * Verified against Foundry 13.351 / dnd5e 5.3.3.
 *
 * WHY `init` AND NOT `setup`: dnd5e builds its data model schemas from CONFIG
 * the first time a document is touched, which happens after `init` completes.
 * Register late and the currency table will list coins that no actor has a
 * field for.
 *
 * WHY IN-PLACE MUTATION AND NOT REPLACEMENT: `CurrencyTemplate.defineSchema()`
 * captures `CONFIG.DND5E.currencies` *by reference* as its `initialKeys`.
 * Assigning a fresh object to `CONFIG.DND5E.currencies` leaves the schema
 * pointing at the old one. Mutating the object the system already holds is
 * correct no matter when the schema gets built.
 */

(() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Flags                                                              */
  /* ------------------------------------------------------------------ */

  const FEATURES = {
    /** Ceramic Tokens, Ceramic Bits and Lead Beads, at gp/sp/cp parity. */
    ceramicCurrency: true,

    /**
     * Strip pp/gp/ep/sp/cp from the world.
     *
     * DESTRUCTIVE. Removing a coin deletes its field from every actor's
     * schema, and any balance still held in it becomes unreadable. Run
     * `game.darkSun.convertCurrency()` from a macro FIRST, confirm the numbers,
     * then set this true and reload. Ignored unless `ceramicCurrency` is on.
     */
    removeLegacyCurrency: false,

    /** Psionic as a ninth spell school, so powers filter and list like spells. */
    psionicSchool: true,

    /** A Psionic tag for anything of psionic origin — power, blade, gear, talent. */
    psionicProperty: true,

    /** Wood/Bone/Stone/Obsidian/Metal tags on weapons and armour. */
    materialProperties: true,

    /** Silt as a vehicle type, for skimmers on the Sea of Silt. */
    siltVehicles: true
  };

  /** Background art for the silt vehicle sheet. "water", "land", "air", "space". */
  const SILT_UNDERLAY = "water";

  const TAG = "dark-sun |";

  /* ------------------------------------------------------------------ */
  /*  Icons                                                              */
  /* ------------------------------------------------------------------ */

  /** Inline the artwork so the script stays a single file with no asset drop. */
  const svg = markup => `data:image/svg+xml,${encodeURIComponent(markup.trim())}`;

  const ICONS = {
    ceramicToken: svg(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="28" fill="#c96f42"/>
  <circle cx="32" cy="32" r="28" fill="none" stroke="#8a4526" stroke-width="3"/>
  <circle cx="32" cy="32" r="20" fill="none" stroke="#e8a06f" stroke-width="2" opacity="0.8"/>
  <path d="M32 16v32M16 32h32" stroke="#8a4526" stroke-width="3" stroke-linecap="round" opacity="0.55"/>
  <circle cx="32" cy="32" r="5" fill="#f2c9a5"/>
</svg>`),

    ceramicBit: svg(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 5 L57 22 L48 52 L32 59 L14 50 L7 21 Z" fill="#c96f42" opacity="0.25"/>
  <path d="M32 5 L57 22 L48 52 L32 59 Z" fill="#c96f42"/>
  <path d="M32 5 L57 22 L48 52 L32 59 Z" fill="none" stroke="#8a4526" stroke-width="3" stroke-linejoin="round"/>
  <path d="M32 5 L32 59" stroke="#8a4526" stroke-width="2.5" opacity="0.7"/>
  <path d="M38 18 L47 26 L43 44" fill="none" stroke="#e8a06f" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
</svg>`),

    leadBead: svg(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="24" fill="#6e737a"/>
  <circle cx="32" cy="32" r="24" fill="none" stroke="#3f4349" stroke-width="3"/>
  <ellipse cx="32" cy="32" rx="7" ry="9" fill="#2c2f34"/>
  <path d="M20 20a17 17 0 0 1 9-6" stroke="#aab0b8" stroke-width="3.5" stroke-linecap="round" fill="none"/>
</svg>`),

    // The module's file version uses `currentColor`, which has nothing to
    // inherit from inside a data URI. Fixed to an explicit violet here.
    psionic: svg(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 6c-9 0-16 6-16 14 0 5 2 8 2 12 0 5-4 7-4 12 0 8 8 14 18 14s18-6 18-14c0-5-4-7-4-12 0-4 2-7 2-12 0-8-7-14-16-14Z" fill="none" stroke="#8a6fb0" stroke-width="3.5" stroke-linejoin="round"/>
  <circle cx="32" cy="30" r="6" fill="#8a6fb0"/>
  <path d="M32 30 L32 12M32 30 L18 40M32 30 L46 40" stroke="#8a6fb0" stroke-width="2.5" stroke-linecap="round" opacity="0.65"/>
  <circle cx="32" cy="10" r="2.6" fill="#8a6fb0"/>
  <circle cx="16.5" cy="42" r="2.6" fill="#8a6fb0"/>
  <circle cx="47.5" cy="42" r="2.6" fill="#8a6fb0"/>
</svg>`)
  };

  /* ------------------------------------------------------------------ */
  /*  Definitions                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * dnd5e's `conversion` answers "how many of this coin equal one gp".
   * Ceramic mirrors gold/silver/copper exactly, so the numbers match.
   *
   * Labels are plain English rather than i18n keys. dnd5e pre-localizes these
   * tables at `i18nInit`, and `game.i18n.localize()` returns any string it
   * cannot find unchanged — so a literal passes through intact. These objects
   * must also stay unfrozen: that pre-localization pass writes back into them
   * in place, and a frozen entry throws and takes the rest of the pass with it.
   *
   * The Lead Bead is keyed `lb` but abbreviated `bd`. `lb` is also dnd5e's
   * abbreviation for the pound, and a sheet prints coin and carried weight
   * within an inch of each other. The key is what balances are stored under
   * and never reaches the user, so only the display form differs.
   */
  const CERAMIC = {
    ct: { label: "Ceramic Token", abbreviation: "ct", conversion: 1, icon: ICONS.ceramicToken },
    cb: { label: "Ceramic Bit", abbreviation: "cb", conversion: 10, icon: ICONS.ceramicBit },
    lb: { label: "Lead Bead", abbreviation: "bd", conversion: 100, icon: ICONS.leadBead }
  };

  const CERAMIC_KEYS = Object.keys(CERAMIC);
  const LEGACY_KEYS = ["pp", "gp", "ep", "sp", "cp"];
  const DEFAULT_CERAMIC_KEY = "ct";

  /** Athasian materials. Descriptive tags — no resistance-piercing, no automation. */
  const MATERIALS = {
    wood: { label: "Wood" },
    bone: { label: "Bone" },
    stone: { label: "Stone" },
    obsidian: { label: "Obsidian" },
    metal: { label: "Metal" }
  };

  /** dnd5e models armour as the `equipment` item type. */
  const MATERIAL_ITEM_TYPES = ["weapon", "equipment"];

  /**
   * One key for both tables. They are separate — a spell school and an item
   * property cannot collide — and sharing it keeps one spelling in stored data.
   */
  const PSIONIC_KEY = "psi";

  /** `fullKey` is the alternate spelling enrichers accept, so `psionic` resolves too. */
  const PSIONIC_SCHOOL = { label: "Psionic", icon: ICONS.psionic, fullKey: "psionic" };

  /**
   * The school says what kind of magic a power is. The property says a thing is
   * psionic at all — which a wild talent, a mind-forged blade and a brewed
   * draught all need, and only the first of those is a spell.
   */
  const PSIONIC_PROPERTY = { label: "Psionic", icon: ICONS.psionic };

  const PSIONIC_ITEM_TYPES = ["spell", "weapon", "equipment", "consumable", "feat"];

  /**
   * Fed to `CONFIG.DND5E.vehicleTypes`, which does double duty: it fills the
   * vehicle sheet's type dropdown (`system.details.type`) AND registers the
   * matching vehicle proficiency (`tool:vehicle:silt`).
   */
  const SILT_VEHICLE_TYPE = "Silt Vehicle";

  /* ------------------------------------------------------------------ */
  /*  Currency arithmetic (pure — no Foundry globals)                    */
  /* ------------------------------------------------------------------ */

  /** Lead beads per gold piece. The base every conversion runs through. */
  const BASE_PER_GP = 100;

  /**
   * Read a balance defensively. World data accumulates junk over years: nulls
   * from partial migrations, strings from macros, floats from module bugs.
   * Anything unusable reads as zero rather than poisoning the sum with NaN.
   */
  function readCoin(currency, key) {
    const raw = Number(currency?.[key]);
    if ( !Number.isFinite(raw) || (raw <= 0) ) return 0;
    return Math.floor(raw);
  }

  function toBaseUnits(amount, conversion) {
    if ( !Number.isFinite(conversion) || (conversion <= 0) ) return null;
    return (amount / conversion) * BASE_PER_GP;
  }

  function splitBaseUnits(base) {
    const whole = Math.floor(base);
    return {
      ct: Math.floor(whole / 100),
      cb: Math.floor((whole % 100) / 10),
      lb: whole % 10,
      remainder: base - whole
    };
  }

  /**
   * Fold legacy balances into ceramic coin.
   *
   * Exact for every standard denomination. Electrum, the only coin without a
   * 1:1 ceramic partner, lands cleanly at 1 ep = 5 cb. Existing ceramic is
   * added to rather than overwritten, and legacy coins are zeroed as they are
   * folded in — so running this twice is a no-op.
   */
  function convertLegacyToCeramic(currency, rates) {
    let base = 0;
    const zeroed = {};
    const skipped = [];

    for ( const key of LEGACY_KEYS ) {
      const amount = readCoin(currency, key);
      if ( amount === 0 ) continue;
      const value = toBaseUnits(amount, rates?.[key]?.conversion);
      if ( value === null ) { skipped.push(key); continue; }
      base += value;
      zeroed[key] = 0;
    }

    if ( !Object.keys(zeroed).length ) {
      return { currency: {}, converted: false, remainder: 0, skipped };
    }

    for ( const key of CERAMIC_KEYS ) {
      const held = readCoin(currency, key);
      if ( held === 0 ) continue;
      const value = toBaseUnits(held, CERAMIC[key].conversion);
      if ( value !== null ) base += value;
    }

    const { ct, cb, lb, remainder } = splitBaseUnits(base);
    return { currency: { ...zeroed, ct, cb, lb }, converted: true, remainder, skipped };
  }

  /**
   * The ceramic denomination a legacy price should be quoted in, chosen so the
   * printed number does not change: gp and ct are the same value, as are
   * sp/cb and cp/lb. Platinum and electrum have no partner, so they are
   * restated with the value scaled.
   */
  const PRICE_MAP = {
    pp: { denomination: "ct", multiplier: 10 },
    gp: { denomination: "ct", multiplier: 1 },
    ep: { denomination: "cb", multiplier: 5 },
    sp: { denomination: "cb", multiplier: 1 },
    cp: { denomination: "lb", multiplier: 1 }
  };

  function convertPrice(price) {
    const mapping = PRICE_MAP[price?.denomination];
    if ( !mapping ) return null;
    const value = Number(price?.value);
    return {
      value: Number.isFinite(value) ? value * mapping.multiplier : 0,
      denomination: mapping.denomination
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Migration                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Read the world and propose changes. Writes nothing.
   *
   * Compendium packs are deliberately untouched: system packs are locked, and
   * rewriting the rest would be undone by the next system update. The scan
   * counts them rather than pretending they are not there.
   */
  function scanWorld() {
    const plan = {
      actors: [], items: [], embedded: new Map(), synthetic: new Map(),
      remainder: 0, skippedCoins: [], compendiums: 0
    };
    const skipped = new Set();
    const rates = CONFIG.DND5E.currencies;

    const noteCurrency = (doc, into, id) => {
      if ( !doc?.system?.currency ) return false;
      const result = convertLegacyToCeramic(doc.system.currency, rates);
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

    for ( const actor of game.actors ) {
      noteCurrency(actor, plan.actors);
      const itemUpdates = collectItemPrices(actor.items);
      if ( itemUpdates.length ) plan.embedded.set(actor.id, itemUpdates);
    }

    plan.items = collectItemPrices(game.items);

    // Unlinked tokens carry their own actor data as a delta on the scene.
    for ( const scene of game.scenes ) {
      const updates = [];
      for ( const token of scene.tokens ) {
        if ( token.actorLink || !token.actor ) continue;
        const staged = [];
        if ( noteCurrency(token.actor, staged, token.id) ) {
          updates.push({ _id: token.id, delta: { system: staged[0].system } });
        }
      }
      if ( updates.length ) plan.synthetic.set(scene.id, updates);
    }

    plan.compendiums = game.packs.filter(p => ["Actor", "Item"].includes(p.documentName)).length;
    plan.skippedCoins = [...skipped];
    return plan;
  }

  function summarise(plan) {
    const embedded = [...plan.embedded.values()].reduce((n, u) => n + u.length, 0);
    const tokens = [...plan.synthetic.values()].reduce((n, u) => n + u.length, 0);
    const items = plan.items.length + embedded;
    return {
      actors: plan.actors.length, items, tokens,
      compendiums: plan.compendiums, remainder: plan.remainder,
      skippedCoins: plan.skippedCoins,
      empty: !plan.actors.length && !items && !tokens
    };
  }

  /**
   * Convert every purse and price in the world to ceramic coin.
   *
   * Defaults to a dry run: it reports what it would touch and writes nothing.
   * Pass `{ commit: true }` to actually do it. Back the world up first — this
   * cannot be undone from inside Foundry.
   *
   * @param {object}  [options]
   * @param {boolean} [options.commit=false]  Write the changes.
   * @returns {Promise<object>}
   */
  async function convertCurrency({ commit = false } = {}) {
    if ( !game.user?.isGM ) {
      ui.notifications?.error("Only the GM can convert currency.");
      return null;
    }

    const plan = scanWorld();
    const summary = summarise(plan);

    console.log(TAG, commit ? "Converting currency:" : "Dry run — nothing written:", summary);

    if ( summary.empty ) {
      ui.notifications?.info("Nothing to convert: no standard coin or pricing in this world.");
      return summary;
    }

    if ( !commit ) {
      ui.notifications?.info(
        `Dry run: ${summary.actors} actors, ${summary.items} items, ${summary.tokens} unlinked tokens `
        + `would convert. ${summary.compendiums} compendium packs left alone. `
        + `Re-run with { commit: true } to apply.`
      );
      return summary;
    }

    const errors = [];
    let actors = 0;
    let items = 0;
    let tokens = 0;

    // Caught per collection so one bad document cannot abort the run and
    // leave the world half-converted.
    const attempt = async (label, fn) => {
      try { return await fn(); }
      catch ( error ) {
        console.error(TAG, `${label} failed:`, error);
        errors.push(`${label}: ${error.message}`);
        return null;
      }
    };

    if ( plan.actors.length ) {
      actors = (await attempt("Actor currency", () =>
        Actor.updateDocuments(plan.actors, { render: false })))?.length ?? 0;
    }

    if ( plan.items.length ) {
      items += (await attempt("World item prices", () =>
        Item.updateDocuments(plan.items, { render: false })))?.length ?? 0;
    }

    for ( const [actorId, updates] of plan.embedded ) {
      const actor = game.actors.get(actorId);
      if ( !actor ) continue;
      items += (await attempt(`Carried item prices on ${actor.name}`, () =>
        actor.updateEmbeddedDocuments("Item", updates, { render: false })))?.length ?? 0;
    }

    for ( const [sceneId, updates] of plan.synthetic ) {
      const scene = game.scenes.get(sceneId);
      if ( !scene ) continue;
      tokens += (await attempt(`Unlinked tokens on ${scene.name}`, () =>
        scene.updateEmbeddedDocuments("Token", updates, { render: false })))?.length ?? 0;
    }

    const result = { actors, items, tokens, errors };
    console.log(TAG, "Migration complete:", result);

    if ( errors.length ) {
      ui.notifications?.error(
        `Currency migration finished, but ${errors.length} operations failed. See the console.`,
        { permanent: true }
      );
    } else {
      ui.notifications?.info(
        `Converted ${actors} actors, ${items} items and ${tokens} unlinked tokens to ceramic coin.`
      );
    }
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Apply                                                              */
  /* ------------------------------------------------------------------ */

  Hooks.once("init", () => {
    const dnd5e = CONFIG.DND5E;
    if ( !dnd5e ) {
      console.error(TAG, "CONFIG.DND5E is missing. This world is not running the dnd5e system.");
      return;
    }

    const applied = [];

    /* --- Coinage --- */
    if ( FEATURES.ceramicCurrency && dnd5e.currencies ) {
      Object.assign(dnd5e.currencies, CERAMIC);
      dnd5e.defaultCurrency = DEFAULT_CERAMIC_KEY;

      if ( FEATURES.removeLegacyCurrency ) {
        for ( const key of LEGACY_KEYS ) delete dnd5e.currencies[key];
        applied.push("ceramic coinage (legacy removed)");
        console.warn(TAG,
          "Standard coinage removed. Any balance still held in pp/gp/ep/sp/cp is now unreadable. "
          + "If you have not run game.darkSun.convertCurrency({ commit: true }), restore from backup.");
      } else {
        applied.push("ceramic coinage");
      }
    } else if ( FEATURES.removeLegacyCurrency ) {
      // Refuse the silently-destructive half-state: a world with no currency
      // at all is worse than a world with the wrong currency.
      console.warn(TAG, "removeLegacyCurrency ignored — ceramicCurrency is off, so nothing would replace them.");
    }

    /* --- Psionic school --- */
    if ( FEATURES.psionicSchool && dnd5e.spellSchools ) {
      dnd5e.spellSchools[PSIONIC_KEY] = PSIONIC_SCHOOL;
      applied.push("psionic school");
    }

    /**
     * Add property keys to the live Sets the system reads at render time.
     * An item type the system has not defined is created rather than skipped.
     */
    const addValidProperties = (keys, types) => {
      for ( const type of types ) {
        if ( !(dnd5e.validProperties[type] instanceof Set) ) dnd5e.validProperties[type] = new Set();
        for ( const key of keys ) dnd5e.validProperties[type].add(key);
      }
    };

    /* --- Material properties --- */
    if ( FEATURES.materialProperties && dnd5e.itemProperties && dnd5e.validProperties ) {
      Object.assign(dnd5e.itemProperties, MATERIALS);
      addValidProperties(Object.keys(MATERIALS), MATERIAL_ITEM_TYPES);
      applied.push("material properties");
    }

    /* --- Psionic property --- */
    if ( FEATURES.psionicProperty && dnd5e.itemProperties && dnd5e.validProperties ) {
      dnd5e.itemProperties[PSIONIC_KEY] = PSIONIC_PROPERTY;
      addValidProperties([PSIONIC_KEY], PSIONIC_ITEM_TYPES);
      applied.push("psionic property");
    }

    /* --- Silt vehicles --- */
    if ( FEATURES.siltVehicles && dnd5e.vehicleTypes ) {
      dnd5e.vehicleTypes.silt = SILT_VEHICLE_TYPE;

      // The vehicle sheet paints its background from --underlay-vehicle-<type>.
      // dnd5e only defines land/water/air/space, so silt would render bare.
      const style = document.createElement("style");
      style.textContent =
        `:root { --underlay-vehicle-silt: var(--underlay-vehicle-${SILT_UNDERLAY}); }`;
      document.head.appendChild(style);

      applied.push("silt vehicles");
    }

    // A small public surface, so macros can drive the migration.
    game.darkSun = { convertCurrency, scanWorld, summarise, FEATURES };

    console.log(TAG, applied.length ? `Applied: ${applied.join(", ")}.` : "No features enabled.");
  });
})();
