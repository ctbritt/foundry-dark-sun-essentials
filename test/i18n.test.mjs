import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_ID = "dark-sun-essentials";

const lang = JSON.parse(readFileSync(join(ROOT, "lang", "en.json"), "utf8"));

/**
 * Every abbreviation dnd5e 5.3.3 prints, from its own config tables
 * (`dnd5e.mjs`: currencies, weightUnits, volumeUnits, movementUnits).
 */
const DND5E_ABBREVIATIONS = [
  "pp", "gp", "ep", "sp", "cp",     // currencies
  "lb", "tn", "kg", "Mg",           // weightUnits
  "ft", "mi", "m", "km"             // movementUnits
];

/** Every source file that could reference a localization key. */
function sourceFiles(dir = ROOT, found = []) {
  for ( const entry of readdirSync(dir) ) {
    if ( ["node_modules", ".git", "test", "docs"].includes(entry) ) continue;
    const path = join(dir, entry);
    if ( statSync(path).isDirectory() ) sourceFiles(path, found);
    else if ( [".mjs", ".hbs", ".js"].includes(extname(path)) ) found.push(path);
  }
  return found;
}

const files = sourceFiles();

/**
 * Keys written out in full, either as `dark-sun-essentials.foo` or as
 * `${MODULE_ID}.foo` inside a template literal.
 */
function staticKeys() {
  const keys = new Map();
  const patterns = [
    new RegExp(`${MODULE_ID}\\.([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)*)`, "g"),
    /\$\{MODULE_ID\}\.([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)/g
  ];
  for ( const file of files ) {
    const text = readFileSync(file, "utf8");
    for ( const pattern of patterns ) {
      for ( const match of text.matchAll(pattern) ) {
        // Skip file paths (icons, templates).
        if ( /\.(svg|hbs|css|json|webp|png)$/.test(match[1]) ) continue;
        // Skip stems truncated by a second interpolation — `${MODULE_ID}.migration.${key}`
        // matches only as far as `migration`, which is a prefix, not a key.
        const rest = text.slice(match.index + match[0].length);
        if ( rest.startsWith(".${") || rest.startsWith(".$") ) continue;
        keys.set(`${MODULE_ID}.${match[1]}`, file.replace(`${ROOT}/`, ""));
      }
    }
  }
  return keys;
}

test("every localization key used in source exists in en.json", () => {
  const missing = [];
  for ( const [key, file] of staticKeys() ) {
    if ( !(key in lang) ) missing.push(`${key} (${file})`);
  }
  assert.deepEqual(missing, [], `Missing keys:\n  ${missing.join("\n  ")}`);
});

test("the dynamically-built migration and notify keys all exist", () => {
  // buildContent() and the notification helpers assemble these at runtime, so
  // the static scan cannot see them. They are the copy a GM reads while
  // deciding whether to rewrite their world's money; a missing one is loud.
  const migration = [
    "title", "intro", "introRemoval", "countActors", "countItems", "countTokens",
    "rates", "packsIntro", "packRow", "packsLocked", "skippedCoins", "remainder",
    "warning", "confirm", "cancel", "keepAnyway", "removeAnyway", "revert",
    "errorsTitle", "errorsIntro", "close"
  ];
  const notify = [
    "incompatible", "gmOnly", "removalNeedsCeramic", "nothingToConvert", "migrationDone",
    "migrationPartial", "packsDone", "removalReverted", "untestedSystem"
  ];

  const missing = [
    ...migration.map(k => `${MODULE_ID}.migration.${k}`),
    ...notify.map(k => `${MODULE_ID}.notify.${k}`)
  ].filter(key => !(key in lang));

  assert.deepEqual(missing, []);
});

test("no localization key is defined but unused", () => {
  const used = new Set(staticKeys().keys());
  // Runtime-assembled families the static scan cannot resolve.
  const dynamic = /^dark-sun-essentials\.(migration|notify)\./;
  const orphans = Object.keys(lang).filter(key => !used.has(key) && !dynamic.test(key));
  assert.deepEqual(orphans, [], `Unused keys:\n  ${orphans.join("\n  ")}`);
});

test("no coin abbreviation collides with one dnd5e already prints", () => {
  // A sheet renders coin and carried weight inches apart, so a Lead Bead
  // abbreviated `lb` reads as pounds. It is keyed `lb` — that is what balances
  // are stored under and it never faces the user — but shown as `bd`.
  const abbreviations = Object.entries(lang)
    .filter(([key]) => /^dark-sun-essentials\.currency\.\w+\.abbr$/.test(key))
    .map(([key, value]) => [key, String(value)]);

  assert.equal(abbreviations.length, 3, "expected three ceramic denominations");

  const collisions = abbreviations
    .filter(([, abbr]) => DND5E_ABBREVIATIONS.includes(abbr))
    .map(([key, abbr]) => `${key} = "${abbr}"`);

  assert.deepEqual(collisions, [],
    `These read as a dnd5e unit or coin:\n  ${collisions.join("\n  ")}`);
});

test("coin abbreviations are distinct from each other", () => {
  const abbreviations = Object.entries(lang)
    .filter(([key]) => /^dark-sun-essentials\.currency\.\w+\.abbr$/.test(key))
    .map(([, value]) => String(value));
  assert.equal(new Set(abbreviations).size, abbreviations.length);
});

test("no localization value is left empty", () => {
  const empty = Object.entries(lang).filter(([, value]) => !String(value).trim());
  assert.deepEqual(empty.map(([k]) => k), []);
});

test("interpolation placeholders are balanced", () => {
  // Foundry's format() uses {name}. An unclosed brace renders literally.
  const broken = Object.entries(lang).filter(([, value]) => {
    const text = String(value);
    return (text.split("{").length !== text.split("}").length);
  });
  assert.deepEqual(broken.map(([k]) => k), []);
});

test("module.json points at files that exist", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
  const declared = [
    ...manifest.esmodules,
    ...manifest.styles,
    ...manifest.languages.map(l => l.path)
  ];
  const missing = declared.filter(path => {
    try {
      statSync(join(ROOT, path));
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(missing, []);
});

test("asset paths referenced in config point at files that exist", () => {
  // Currency and school icons are declared as module-relative URLs; a typo
  // shows up as a broken image on a character sheet, not an error.
  const referenced = new Set();
  for ( const file of files.filter(f => f.includes("/core/")) ) {
    const text = readFileSync(file, "utf8");
    for ( const match of text.matchAll(/modules\/\$\{MODULE_ID\}\/([^`"']+)/g) ) {
      referenced.add(match[1]);
    }
  }
  assert.ok(referenced.size >= 4, "expected at least the three coins and the psionic icon");

  const missing = [...referenced].filter(path => {
    try {
      statSync(join(ROOT, path));
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(missing, []);
});
