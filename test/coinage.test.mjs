import test from "node:test";
import assert from "node:assert/strict";

import {
  CERAMIC_CURRENCIES,
  STANDARD_RATES,
  buildCurrencyConfig,
  convertLegacyToCeramic,
  convertPrice,
  readCoin,
  splitBaseUnits,
  toBaseUnits
} from "../scripts/core/coinage.mjs";

/* -------------------------------------------- */
/*  Denominations                                */
/* -------------------------------------------- */

test("ceramic coins mirror gp/sp/cp exactly", () => {
  assert.equal(CERAMIC_CURRENCIES.ct.conversion, STANDARD_RATES.gp.conversion);
  assert.equal(CERAMIC_CURRENCIES.cb.conversion, STANDARD_RATES.sp.conversion);
  assert.equal(CERAMIC_CURRENCIES.lb.conversion, STANDARD_RATES.cp.conversion);
});

test("ceramic coins carry the fields dnd5e's CurrencyConfiguration requires", () => {
  for ( const [key, config] of Object.entries(CERAMIC_CURRENCIES) ) {
    assert.equal(typeof config.label, "string", `${key} label`);
    assert.equal(typeof config.abbreviation, "string", `${key} abbreviation`);
    assert.equal(typeof config.conversion, "number", `${key} conversion`);
    assert.equal(typeof config.icon, "string", `${key} icon`);
  }
});

/* -------------------------------------------- */
/*  Coercion                                     */
/* -------------------------------------------- */

test("readCoin coerces the junk that accumulates in old world data", () => {
  assert.equal(readCoin({ gp: 5 }, "gp"), 5);
  assert.equal(readCoin({ gp: "7" }, "gp"), 7, "strings from macros");
  assert.equal(readCoin({ gp: 2.9 }, "gp"), 2, "floats floor, never round up");
  assert.equal(readCoin({ gp: -3 }, "gp"), 0, "negatives cannot create money");
  assert.equal(readCoin({ gp: null }, "gp"), 0);
  assert.equal(readCoin({ gp: NaN }, "gp"), 0);
  assert.equal(readCoin({}, "gp"), 0);
  assert.equal(readCoin(null, "gp"), 0, "missing currency object");
});

/* -------------------------------------------- */
/*  Base units                                   */
/* -------------------------------------------- */

test("every standard coin converts to a whole number of lead beads", () => {
  const expected = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
  for ( const [key, beads] of Object.entries(expected) ) {
    const value = toBaseUnits(1, STANDARD_RATES[key].conversion);
    assert.equal(value, beads, `1 ${key}`);
    assert.ok(Number.isInteger(value), `1 ${key} is exact`);
  }
});

test("toBaseUnits refuses unusable conversion rates", () => {
  assert.equal(toBaseUnits(1, 0), null);
  assert.equal(toBaseUnits(1, -1), null);
  assert.equal(toBaseUnits(1, undefined), null);
  assert.equal(toBaseUnits(1, NaN), null);
});

test("splitBaseUnits fills largest denominations first", () => {
  assert.deepEqual(splitBaseUnits(0), { ct: 0, cb: 0, lb: 0, remainder: 0 });
  assert.deepEqual(splitBaseUnits(1), { ct: 0, cb: 0, lb: 1, remainder: 0 });
  assert.deepEqual(splitBaseUnits(10), { ct: 0, cb: 1, lb: 0, remainder: 0 });
  assert.deepEqual(splitBaseUnits(100), { ct: 1, cb: 0, lb: 0, remainder: 0 });
  assert.deepEqual(splitBaseUnits(1234), { ct: 12, cb: 3, lb: 4, remainder: 0 });
});

test("splitBaseUnits reports fractions instead of swallowing them", () => {
  const { ct, cb, lb, remainder } = splitBaseUnits(100.5);
  assert.deepEqual({ ct, cb, lb }, { ct: 1, cb: 0, lb: 0 });
  assert.ok(Math.abs(remainder - 0.5) < 1e-9);
});

/* -------------------------------------------- */
/*  Documented conversion rates                  */
/* -------------------------------------------- */

test("each legacy coin converts at the rate the design documents", () => {
  const cases = [
    ["pp", 1, { ct: 10, cb: 0, lb: 0 }],
    ["gp", 1, { ct: 1, cb: 0, lb: 0 }],
    ["ep", 1, { ct: 0, cb: 5, lb: 0 }],
    ["sp", 1, { ct: 0, cb: 1, lb: 0 }],
    ["cp", 1, { ct: 0, cb: 0, lb: 1 }]
  ];
  for ( const [key, amount, expected] of cases ) {
    const { currency, converted, remainder } = convertLegacyToCeramic({ [key]: amount });
    assert.equal(converted, true, `${key} converts`);
    assert.equal(remainder, 0, `${key} converts exactly`);
    assert.equal(currency[key], 0, `${key} is zeroed`);
    assert.deepEqual({ ct: currency.ct, cb: currency.cb, lb: currency.lb }, expected, `${key} value`);
  }
});

test("conversion loses nothing — the whole standard table is exact", () => {
  const { remainder, skipped } = convertLegacyToCeramic({ pp: 7, gp: 13, ep: 3, sp: 9, cp: 41 });
  assert.equal(remainder, 0);
  assert.deepEqual(skipped, []);
});

test("a mixed hoard sums correctly", () => {
  // 2pp=2000, 5gp=500, 1ep=50, 3sp=30, 7cp=7 -> 2587 beads -> 25ct 8cb 7lb
  const { currency } = convertLegacyToCeramic({ pp: 2, gp: 5, ep: 1, sp: 3, cp: 7 });
  assert.deepEqual({ ct: currency.ct, cb: currency.cb, lb: currency.lb }, { ct: 25, cb: 8, lb: 7 });
});

/* -------------------------------------------- */
/*  Safety properties                            */
/* -------------------------------------------- */

test("existing ceramic balances are added to, never overwritten", () => {
  const { currency } = convertLegacyToCeramic({ gp: 1, ct: 4, cb: 2, lb: 3 });
  // 1gp=100, plus held 4ct=400, 2cb=20, 3lb=3 -> 523 -> 5ct 2cb 3lb
  assert.deepEqual({ ct: currency.ct, cb: currency.cb, lb: currency.lb }, { ct: 5, cb: 2, lb: 3 });
});

test("conversion is idempotent — running it twice changes nothing", () => {
  const start = { pp: 1, gp: 2, ep: 3, sp: 4, cp: 5 };
  const first = convertLegacyToCeramic(start);
  const merged = { ...start, ...first.currency };

  const second = convertLegacyToCeramic(merged);
  assert.equal(second.converted, false, "nothing left to convert");
  assert.deepEqual(second.currency, {}, "no writes proposed");
});

test("an empty purse proposes no write at all", () => {
  const { converted, currency } = convertLegacyToCeramic({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
  assert.equal(converted, false);
  assert.deepEqual(currency, {});
});

test("a purse holding only ceramic is left untouched", () => {
  const { converted } = convertLegacyToCeramic({ ct: 12, cb: 3, lb: 4 });
  assert.equal(converted, false, "no legacy coin means no rewrite");
});

test("total value is preserved across conversion", () => {
  const purse = { pp: 3, gp: 17, ep: 5, sp: 22, cp: 91 };
  const valueBefore = Object.entries(purse)
    .reduce((sum, [k, v]) => sum + toBaseUnits(v, STANDARD_RATES[k].conversion), 0);

  const { currency } = convertLegacyToCeramic(purse);
  const valueAfter = ["ct", "cb", "lb"]
    .reduce((sum, k) => sum + toBaseUnits(currency[k], CERAMIC_CURRENCIES[k].conversion), 0);

  assert.equal(valueAfter, valueBefore, "not a bead was lost");
});

test("a coin with an unusable rate is skipped, not silently destroyed", () => {
  const rates = { ...STANDARD_RATES, gp: { conversion: 0 } };
  const { currency, skipped } = convertLegacyToCeramic({ gp: 5, sp: 2 }, { rates });
  assert.deepEqual(skipped, ["gp"]);
  assert.equal(currency.gp, undefined, "the balance is left where it is");
  assert.equal(currency.cb, 2, "the coins that could convert still did");
});

test("homebrew currencies convert when their rate is supplied", () => {
  const rates = { ...STANDARD_RATES, bloodstone: { conversion: 0.01 } };
  const { currency, remainder } = convertLegacyToCeramic(
    { bloodstone: 1 },
    { rates, from: ["bloodstone"] }
  );
  assert.equal(remainder, 0);
  assert.equal(currency.ct, 100, "1 bloodstone = 100 gp = 100 ct");
});

/* -------------------------------------------- */
/*  Prices                                       */
/* -------------------------------------------- */

test("gp/sp/cp prices keep their number and only change coin", () => {
  assert.deepEqual(convertPrice({ value: 15, denomination: "gp" }), { value: 15, denomination: "ct" });
  assert.deepEqual(convertPrice({ value: 15, denomination: "sp" }), { value: 15, denomination: "cb" });
  assert.deepEqual(convertPrice({ value: 15, denomination: "cp" }), { value: 15, denomination: "lb" });
});

test("pp/ep prices are restated at equivalent value", () => {
  assert.deepEqual(convertPrice({ value: 2, denomination: "pp" }), { value: 20, denomination: "ct" });
  assert.deepEqual(convertPrice({ value: 2, denomination: "ep" }), { value: 10, denomination: "cb" });
});

test("prices already in ceramic, or in an unknown coin, are left alone", () => {
  assert.equal(convertPrice({ value: 5, denomination: "ct" }), null);
  assert.equal(convertPrice({ value: 5, denomination: "bloodstone" }), null);
  assert.equal(convertPrice(undefined), null);
});

test("a malformed price value becomes zero rather than NaN", () => {
  assert.deepEqual(convertPrice({ value: "abc", denomination: "gp" }), { value: 0, denomination: "ct" });
});

/* -------------------------------------------- */
/*  Config assembly                              */
/* -------------------------------------------- */

test("ceramic off leaves the currency table untouched", () => {
  const existing = { gp: STANDARD_RATES.gp };
  const { currencies, defaultCurrency } = buildCurrencyConfig(existing, {
    ceramic: false, removeLegacy: false
  });
  assert.deepEqual(Object.keys(currencies), ["gp"]);
  assert.equal(defaultCurrency, null, "left for the system to decide");
});

test("ceramic on adds three coins beside the old ones", () => {
  const existing = { pp: {}, gp: {}, ep: {}, sp: {}, cp: {} };
  const { currencies, defaultCurrency } = buildCurrencyConfig(existing, {
    ceramic: true, removeLegacy: false
  });
  assert.deepEqual(Object.keys(currencies).sort(), ["cb", "cp", "ct", "ep", "gp", "lb", "pp", "sp"]);
  assert.equal(defaultCurrency, "ct");
});

test("removal strips exactly the standard five", () => {
  const existing = { pp: {}, gp: {}, ep: {}, sp: {}, cp: {} };
  const { currencies } = buildCurrencyConfig(existing, { ceramic: true, removeLegacy: true });
  assert.deepEqual(Object.keys(currencies).sort(), ["cb", "ct", "lb"]);
});

test("removal preserves homebrew currencies it does not know about", () => {
  const existing = { gp: {}, bloodstone: {} };
  const { currencies } = buildCurrencyConfig(existing, { ceramic: true, removeLegacy: true });
  assert.ok("bloodstone" in currencies, "another module's coin survives");
  assert.ok(!("gp" in currencies));
});

test("removal without ceramic is refused — a world needs some currency", () => {
  const existing = { pp: {}, gp: {}, ep: {}, sp: {}, cp: {} };
  const { currencies } = buildCurrencyConfig(existing, { ceramic: false, removeLegacy: true });
  assert.deepEqual(Object.keys(currencies).sort(), ["cp", "ep", "gp", "pp", "sp"]);
});

test("buildCurrencyConfig does not mutate the table it is given", () => {
  const existing = { gp: {} };
  buildCurrencyConfig(existing, { ceramic: true, removeLegacy: true });
  assert.deepEqual(Object.keys(existing), ["gp"]);
});
