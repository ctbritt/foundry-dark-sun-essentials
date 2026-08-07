/**
 * Manifest integrity.
 *
 * These are the mistakes that survive a green test suite and break only once
 * the package is published: a version bumped in one file and not the other, a
 * manifest pointing at a file that was renamed, a release URL that does not
 * match the repository. They cost nothing to check and are miserable to
 * diagnose from a user's console.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(join(ROOT, file), "utf8");
const json = file => JSON.parse(read(file));

const manifest = json("module.json");
const pkg = json("package.json");

/* -------------------------------------------- */
/*  Versions                                     */
/* -------------------------------------------- */

test("module.json and package.json agree on the version", () => {
  assert.equal(manifest.version, pkg.version);
});

test("the version is plain semver, with no leading v", () => {
  // Foundry compares these as versions; a `v` prefix makes every comparison
  // fail silently and the module never offers an update.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test("the changelog documents the current version", () => {
  assert.ok(read("CHANGELOG.md").includes(`## ${manifest.version}`),
    `CHANGELOG.md has no entry for ${manifest.version}`);
});

/* -------------------------------------------- */
/*  Referenced files                             */
/* -------------------------------------------- */

test("every file the manifest points at exists", () => {
  for ( const file of manifest.esmodules ) assert.ok(existsSync(join(ROOT, file)), file);
  for ( const file of manifest.styles ) assert.ok(existsSync(join(ROOT, file)), file);
  for ( const lang of manifest.languages ) assert.ok(existsSync(join(ROOT, lang.path)), lang.path);
});

test("every language file is valid JSON", () => {
  for ( const lang of manifest.languages ) json(lang.path);
});

test("every module-relative asset path resolves to a real file", () => {
  // Icons are referenced as `modules/<id>/...` at runtime, which only resolves
  // once installed. Strip the prefix and check the repo copy. Most are built
  // from a template literal, so the id appears as ${MODULE_ID}.
  const PATTERN = /modules\/(?:dark-sun-essentials|\$\{MODULE_ID\})\/([\w./-]+\.(?:svg|hbs|css|webp|png))/g;
  const sources = ["scripts", "styles"];
  const referenced = new Set();
  const walk = dir => {
    for ( const entry of execFileSync("find", [join(ROOT, dir), "-type", "f"], { encoding: "utf8" }).trim().split("\n") ) {
      if ( !entry ) continue;
      for ( const match of readFileSync(entry, "utf8").matchAll(PATTERN) ) referenced.add(match[1]);
    }
  };
  sources.forEach(walk);

  assert.ok(referenced.size > 0, "no asset references found — has the path format changed?");
  for ( const path of referenced ) assert.ok(existsSync(join(ROOT, path)), `${path} is referenced but missing`);
});

/* -------------------------------------------- */
/*  Release URLs                                 */
/* -------------------------------------------- */

test("the manifest URL tracks the latest release, not a branch", () => {
  // A manifest served from a branch updates the moment a commit lands, which
  // offers users a version whose release assets may not exist yet.
  assert.match(manifest.manifest, /\/releases\/latest\/download\/module\.json$/);
  assert.doesNotMatch(manifest.manifest, /raw\.githubusercontent/);
});

test("the release URLs point at the repository the module claims", () => {
  const repo = new URL(manifest.url).pathname;
  for ( const key of ["manifest", "download", "readme", "bugs"] ) {
    assert.ok(manifest[key].includes(repo), `${key} points somewhere other than ${repo}`);
  }
});

/* -------------------------------------------- */
/*  Compatibility                                */
/* -------------------------------------------- */

test("the manifest declares the system relationship Foundry needs", () => {
  const system = manifest.relationships.systems.find(s => s.id === "dnd5e");
  assert.ok(system, "no dnd5e relationship declared");
  assert.equal(system.type, "system");
  assert.ok(system.compatibility.minimum);
  assert.ok(system.compatibility.verified);
});

test("no maximum is declared, so a system update cannot hard-block the module", () => {
  // The startup verification in compat.mjs is the safety net instead: it
  // disables features it cannot recognise rather than refusing to load.
  assert.equal(manifest.compatibility.maximum, undefined);
  assert.equal(manifest.relationships.systems[0].compatibility.maximum, undefined);
});

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

/* -------------------------------------------- */
/*  World script                                 */
/* -------------------------------------------- */

test("the world script parses as a classic script", () => {
  // world.json `scripts` entries are classic scripts, not modules: top-level
  // import/export would throw on load with no useful error in the console.
  execFileSync(process.execPath, ["--check", join(ROOT, "world-script", "dark-sun-essentials.js")]);
});

test("the world script declares the same feature set as the module", () => {
  const source = read("world-script/dark-sun-essentials.js");
  for ( const key of Object.keys(json("lang/en.json"))
    .filter(k => k.startsWith("dark-sun-essentials.settings."))
    .map(k => k.split(".")[2]) ) {
    assert.ok(new RegExp(`\\b${key}:`).test(source), `world script is missing the ${key} flag`);
  }
});
