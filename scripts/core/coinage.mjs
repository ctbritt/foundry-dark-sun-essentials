/**
 * Athasian coinage: definitions and exact conversion arithmetic.
 *
 * No Foundry globals. Everything here is a pure function so the arithmetic can
 * be tested without booting a world — this is the part of the module that can
 * lose a player's money if it is wrong.
 *
 * dnd5e's `conversion` value answers "how many of this coin equal one gp".
 * So gp is 1, sp is 10, cp is 100, pp is 0.1, ep is 2.
 */

import { CERAMIC_KEYS, LEGACY_KEYS, MODULE_ID } from "./constants.mjs";
import { thaw } from "./config-tables.mjs";

/**
 * Lead beads per gold piece. The common base all conversion runs through:
 * the smallest Athasian coin, and the smallest standard coin, are both 1/100 gp.
 * @type {number}
 */
const BASE_PER_GP = 100;

/**
 * The three Athasian denominations, mirroring gp/sp/cp exactly.
 * Shape matches dnd5e's CurrencyConfiguration typedef.
 * @type {Record<string, {label: string, abbreviation: string, conversion: number, icon: string}>}
 */
export const CERAMIC_CURRENCIES = Object.freeze({
  ct: Object.freeze({
    label: `${MODULE_ID}.currency.ct.label`,
    abbreviation: `${MODULE_ID}.currency.ct.abbr`,
    conversion: 1,
    icon: `modules/${MODULE_ID}/icons/ceramic-token.svg`
  }),
  cb: Object.freeze({
    label: `${MODULE_ID}.currency.cb.label`,
    abbreviation: `${MODULE_ID}.currency.cb.abbr`,
    conversion: 10,
    icon: `modules/${MODULE_ID}/icons/ceramic-bit.svg`
  }),
  lb: Object.freeze({
    label: `${MODULE_ID}.currency.lb.label`,
    abbreviation: `${MODULE_ID}.currency.lb.abbr`,
    conversion: 100,
    icon: `modules/${MODULE_ID}/icons/lead-bead.svg`
  })
});

/** The coin new items are priced in once ceramic currency is live. */
export const DEFAULT_CERAMIC_KEY = "ct";

/* -------------------------------------------- */
/*  Coercion                                     */
/* -------------------------------------------- */

/**
 * Read a coin balance defensively. World data accumulates junk over years:
 * nulls from partial migrations, strings from macros, floats from module bugs.
 * Anything unusable reads as zero rather than poisoning the arithmetic with NaN.
 * @param {object} currency  A `system.currency` object.
 * @param {string} key       Coin key.
 * @returns {number}         A non-negative integer.
 */
export function readCoin(currency, key) {
  const raw = Number(currency?.[key]);
  if ( !Number.isFinite(raw) || (raw <= 0) ) return 0;
  return Math.floor(raw);
}

/* -------------------------------------------- */
/*  Conversion                                   */
/* -------------------------------------------- */

/**
 * Convert one coin balance into lead-bead units.
 * @param {number} amount      How many coins.
 * @param {number} conversion  The coin's dnd5e conversion rate.
 * @returns {number|null}      Value in lead beads, or null if the rate is unusable.
 */
export function toBaseUnits(amount, conversion) {
  if ( !Number.isFinite(conversion) || (conversion <= 0) ) return null;
  return (amount / conversion) * BASE_PER_GP;
}

/**
 * Split a lead-bead total into ceramic denominations, largest first.
 * @param {number} base  Value in lead beads. Fractions are kept as a remainder.
 * @returns {{ct: number, cb: number, lb: number, remainder: number}}
 */
export function splitBaseUnits(base) {
  const whole = Math.floor(base);
  const remainder = base - whole;
  const ct = Math.floor(whole / 100);
  const cb = Math.floor((whole % 100) / 10);
  const lb = whole % 10;
  return { ct, cb, lb, remainder };
}

/**
 * Fold legacy balances into ceramic coin.
 *
 * Exact for every standard denomination — electrum, the only coin without a
 * 1:1 ceramic partner, lands cleanly at 1 ep = 5 cb. Existing ceramic balances
 * are preserved and added to, so running this twice is a no-op: legacy coins
 * are zeroed as they are folded in.
 *
 * @param {object} currency                     A `system.currency` object.
 * @param {object} [options]
 * @param {Record<string, {conversion: number}>} [options.rates]  Conversion rates
 *   to read legacy coins at. Defaults to the standard dnd5e table. Pass
 *   `CONFIG.DND5E.currencies` to honour homebrew currencies.
 * @param {string[]} [options.from]             Coin keys to convert. Defaults to the standard five.
 * @returns {{currency: object, converted: boolean, remainder: number, skipped: string[]}}
 *   `currency` holds only changed keys — legacy coins zeroed, ceramic coins totalled.
 *   `remainder` is fractional value that would not divide into a lead bead.
 *   `skipped` names coins whose conversion rate was unusable; their balances are untouched.
 */
export function convertLegacyToCeramic(currency, { rates = STANDARD_RATES, from = LEGACY_KEYS } = {}) {
  let base = 0;
  const zeroed = {};
  const skipped = [];

  for ( const key of from ) {
    const amount = readCoin(currency, key);
    if ( amount === 0 ) continue;
    const value = toBaseUnits(amount, rates?.[key]?.conversion);
    if ( value === null ) {
      skipped.push(key);
      continue;
    }
    base += value;
    zeroed[key] = 0;
  }

  const converted = Object.keys(zeroed).length > 0;
  if ( !converted ) return { currency: {}, converted: false, remainder: 0, skipped };

  // Fold in what the actor already holds so nothing is overwritten.
  for ( const key of CERAMIC_KEYS ) {
    const held = readCoin(currency, key);
    if ( held === 0 ) continue;
    const value = toBaseUnits(held, CERAMIC_CURRENCIES[key].conversion);
    if ( value !== null ) base += value;
  }

  const { ct, cb, lb, remainder } = splitBaseUnits(base);
  return { currency: { ...zeroed, ct, cb, lb }, converted: true, remainder, skipped };
}

/**
 * The standard dnd5e conversion table, so the core can be tested and can run
 * as a fallback when CONFIG is unavailable.
 * @type {Record<string, {conversion: number}>}
 */
export const STANDARD_RATES = Object.freeze({
  pp: Object.freeze({ conversion: 0.1 }),
  gp: Object.freeze({ conversion: 1 }),
  ep: Object.freeze({ conversion: 2 }),
  sp: Object.freeze({ conversion: 10 }),
  cp: Object.freeze({ conversion: 100 }),
  ...CERAMIC_CURRENCIES
});

/* -------------------------------------------- */
/*  Prices                                       */
/* -------------------------------------------- */

/**
 * The ceramic denomination a legacy price should be quoted in.
 * Chosen so the numeric price is unchanged: gp and ct are the same value, as
 * are sp/cb and cp/lb. Platinum and electrum have no ceramic partner, so they
 * are restated in ceramic tokens and bits respectively, with the value scaled.
 * @type {Record<string, {denomination: string, multiplier: number}>}
 */
export const PRICE_MAP = Object.freeze({
  pp: Object.freeze({ denomination: "ct", multiplier: 10 }),
  gp: Object.freeze({ denomination: "ct", multiplier: 1 }),
  ep: Object.freeze({ denomination: "cb", multiplier: 5 }),
  sp: Object.freeze({ denomination: "cb", multiplier: 1 }),
  cp: Object.freeze({ denomination: "lb", multiplier: 1 })
});

/**
 * Restate an item price in ceramic coin.
 * @param {{value: number, denomination: string}} price  An item's `system.price`.
 * @returns {{value: number, denomination: string}|null}  Null when no change is needed.
 */
export function convertPrice(price) {
  const mapping = PRICE_MAP[price?.denomination];
  if ( !mapping ) return null;
  const value = Number(price?.value);
  const scaled = Number.isFinite(value) ? value * mapping.multiplier : 0;
  return { value: scaled, denomination: mapping.denomination };
}

/* -------------------------------------------- */
/*  Config assembly                              */
/* -------------------------------------------- */

/**
 * Build the currency table for a given set of toggles.
 * Pure, so the removal path can be tested without a world.
 * @param {object} existing            The current `CONFIG.DND5E.currencies`.
 * @param {object} options
 * @param {boolean} options.ceramic    Add the Athasian coins.
 * @param {boolean} options.removeLegacy  Strip the standard five.
 * @returns {{currencies: object, defaultCurrency: string|null}}
 *   `defaultCurrency` is null when it should be left alone.
 */
export function buildCurrencyConfig(existing, { ceramic, removeLegacy }) {
  const currencies = { ...existing };

  if ( ceramic ) Object.assign(currencies, thaw(CERAMIC_CURRENCIES));

  // Never strip the legacy coins unless something replaces them; a world with
  // no currency at all is worse than a world with the wrong currency.
  if ( removeLegacy && ceramic ) {
    for ( const key of LEGACY_KEYS ) delete currencies[key];
  }

  return {
    currencies,
    defaultCurrency: ceramic ? DEFAULT_CERAMIC_KEY : null
  };
}
