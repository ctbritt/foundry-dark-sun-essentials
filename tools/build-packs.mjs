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
