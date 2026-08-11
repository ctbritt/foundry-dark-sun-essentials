/**
 * Repoint anything that still refers to the compendium packs that moved from
 * `shareddata` to `dark-sun-essentials` in 1.4.0.
 *
 * A compendium address carries the module that owns the pack, so moving a pack
 * changes every reference to it: `Compendium.shareddata.dark-sun-spells.Item.x`
 * becomes `Compendium.dark-sun-essentials.dark-sun-spells.Item.x`. Document IDs
 * and pack names did not change, so the fix is a rename of one segment.
 *
 * That rename cannot be done with sed — LevelDB records are length-prefixed and
 * `dark-sun-essentials` is nine characters longer than `shareddata`. So each
 * record is read, rewritten and written back through the database itself. This
 * touches only the records that match and leaves every other key untouched,
 * which matters: an extract-and-recompile pass loses any key it cannot parse,
 * and at least one world has a hand-written `foundry-rest-api.wsRelayUrl`
 * setting stored without Foundry's `!collection!id` convention.
 *
 * Packs that stayed in `shareddata` — `dark-sun-journals` and every `ddb-*` —
 * are deliberately left alone.
 *
 * The argument is a world directory, a directory of packs, or a single pack.
 * Stop the Foundry server first. Dry run by default; nothing is written
 * without `--write`, and a dry run does not touch the source.
 *
 *   node tools/repoint-moved-packs.mjs /path/to/worlds/test
 *   node tools/repoint-moved-packs.mjs /path/to/worlds/test --write
 *   node tools/repoint-moved-packs.mjs ~/Code/foundry/shareddata/packs --write
 */

import { readdirSync, statSync, existsSync, rmSync, mkdirSync, readFileSync, writeFileSync, cpSync }
  from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";

const MOVED = [
  "dark-sun-character-origins",
  "dark-sun-classes",
  "dark-sun-creature-catalog",
  "dark-sun-equipment",
  "dark-sun-feats",
  "dark-sun-harvest-items",
  "dark-sun-items",
  "dark-sun-rolltables",
  "dark-sun-scenes",
  "dark-sun-spells"
];

// Only the packs that moved, and only where the pack name ends there, so
// `dark-sun-items` can never swallow `dark-sun-items-anything`.
const PATTERN = new RegExp(`shareddata\\.(${MOVED.join("|")})(?![a-z0-9-])`, "g");
const REPLACE = text => text.replace(PATTERN, (_, pack) => `dark-sun-essentials.${pack}`);

const target = process.argv[2];
const write = process.argv.includes("--write");
if ( !target || !existsSync(target) ) {
  console.error("usage: node tools/repoint-moved-packs.mjs <world|packs-dir|pack> [--write]");
  process.exit(1);
}

/** Every LevelDB directory under the target. */
function databases(root) {
  // A LevelDB directory always has a CURRENT manifest pointer.
  const isDb = path => statSync(path).isDirectory() && existsSync(join(path, "CURRENT"));
  if ( isDb(root) ) return [root];

  const found = [];
  const children = name => {
    const dir = join(root, name);
    if ( !existsSync(dir) || !statSync(dir).isDirectory() ) return;
    for ( const entry of readdirSync(dir) ) {
      const path = join(dir, entry);
      if ( isDb(path) ) found.push(path);
    }
  };

  // A world keeps its documents under data/ and its own packs under packs/.
  children("data");
  children("packs");
  if ( found.length ) return found;

  // Otherwise treat the argument as a directory of packs, e.g. a module's own
  // packs/ folder.
  for ( const entry of readdirSync(root) ) {
    const path = join(root, entry);
    if ( isDb(path) ) found.push(path);
  }
  return found;
}

/** Plain JSON files at the world root, e.g. enhanced-creature-index.json. */
function jsonFiles(root) {
  if ( !statSync(root).isDirectory() || existsSync(join(root, "CURRENT")) ) return [];
  return readdirSync(root).filter(name => name.endsWith(".json")).map(name => join(root, name));
}

const scratch = join(tmpdir(), `ds-repoint-${process.pid}`);
let total = 0;

for ( const db of databases(target) ) {
  const label = `${basename(join(db, ".."))}/${basename(db)}`;

  // Opening a LevelDB runs log recovery, which rewrites CURRENT, MANIFEST-*
  // and LOG even when nothing is read out of it — enough to dirty a git
  // working tree. A dry run works on a throwaway copy.
  let path = db;
  if ( !write ) {
    path = join(scratch, label.replace("/", "_"));
    rmSync(path, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });
    cpSync(db, path, { recursive: true });
  }

  const level = new ClassicLevel(path, { keyEncoding: "utf8", valueEncoding: "utf8" });
  await level.open();

  let hits = 0;
  let records = 0;
  // Values are the stored JSON text. Rewriting the text rather than a parsed
  // object keeps untouched fields byte-identical, and catches references
  // nested inside settings whose value is itself an escaped JSON string —
  // core.compendiumConfiguration, which holds every pack's sidebar folder,
  // sort order and lock state, is one of those.
  for await ( const [key, value] of level.iterator() ) {
    const matches = value.match(PATTERN);
    if ( !matches ) continue;
    hits += matches.length;
    records++;
    if ( write ) await level.put(key, REPLACE(value));
  }

  await level.close();
  if ( !write ) rmSync(path, { recursive: true, force: true });

  if ( !hits ) continue;
  total += hits;
  console.log(`${label}: ${hits} reference${hits === 1 ? "" : "s"} in ${records} record${records === 1 ? "" : "s"}`);
}

for ( const path of jsonFiles(target) ) {
  const before = readFileSync(path, "utf8");
  const matches = before.match(PATTERN);
  if ( !matches ) continue;
  total += matches.length;
  console.log(`${basename(path)}: ${matches.length} references`);
  if ( write ) writeFileSync(path, REPLACE(before));
}

rmSync(scratch, { recursive: true, force: true });

console.log(`\n${total} reference(s) ${write ? "rewritten" : "would be rewritten"}.`);
if ( !write ) console.log("Dry run. Re-run with --write to apply.");
