# World-script edition

`dark-sun-essentials.js` is the whole module as a single world script: no
manifest, no installed package, no assets on disk. Everything the module puts in
`CONFIG.DND5E` is a handful of lines, so if you only ever intend to use this in
one world, this is the shorter road.

## Install

> **Shut Foundry down first.** Foundry rewrites `world.json` itself — it stamps
> `lastPlayed` and `playtime` every time the world launches. Edit the manifest
> while the server is up and your change is overwritten with no warning and no
> error. Same rule applies to a module's `module.json`.

1. Shut down Foundry.
2. Copy `dark-sun-essentials.js` into `worlds/<your-world>/scripts/`.
3. Add it to the world's `world.json`, at the **top level** of the object — not
   nested inside `packs` or anything else — watching the commas:

   ```json
   "scripts": [
     "scripts/dark-sun-essentials.js"
   ]
   ```

4. Start Foundry back up. If the world has vanished from the list, the JSON is
   malformed; run it through a linter, with the server down.

Editing the `.js` afterwards needs only a browser refresh (F5). Editing the
manifest needs a full shutdown, every time.

Toggle features by editing the `FEATURES` block at the top of the file. Changes
take effect on the next world reload.

## Alternative: a personal module

A world script belongs to one world. If you want these features across several —
or an on/off switch in the Manage Modules list rather than a file edit — put the
same file in a personal "junk drawer" module instead. Foundry will build the
folder for you: **Setup → Add-on Modules → the cog beside Update All → Create
Module**. Choose the identifier carefully; it cannot be changed later.

Then, with Foundry shut down, drop `dark-sun-essentials.js` into the new module's
folder and add one line to its `module.json`:

```json
"esmodules": ["dark-sun-essentials.js"]
```

The file works unchanged in either slot. `scripts` entries are classic scripts
that share one global scope, `esmodules` entries each get their own — the whole
thing is wrapped in an IIFE, so it is correct in both and cannot collide with
anything else you park in the same module later.

What this buys you: enable or disable per world from the standard module list,
and the same code in `test` and `one-shots` without copying it. What it does not
buy you: per-world feature flags. The `FEATURES` block still lives in the file,
so it is the same everywhere the module is on.

## What you give up

Only three things, and two of them are cosmetic:

- **The settings window.** Flags are edited in the file rather than ticked in a
  dialog — which means a shutdown-free browser refresh, but also that you are
  editing code rather than clicking a checkbox.
- **Portability.** A world script belongs to one world. The module travels. (See
  *Alternative: a personal module* below for the middle road.)
- **The migration dialog.** The arithmetic is here in full and equally tested,
  but it runs from a macro rather than a window with a confirmation screen.

Feature-for-feature the two are otherwise identical, and the script is the
*safer* of the two on one point — see below.

## Converting existing currency

Only needed if you set `removeLegacyCurrency: true`. Deleting a coin removes its
field from every actor's schema, and any balance still held in it becomes
unreadable. Back the world up first, then run this from a macro:

```js
// Reports what it would touch. Writes nothing.
await game.darkSun.convertCurrency();
```

Check the console output, then commit:

```js
await game.darkSun.convertCurrency({ commit: true });
```

Only then set `removeLegacyCurrency: true` and reload.

The conversion is exact — 1 pp → 10 ct, 1 gp → 1 ct, 1 ep → 5 cb, 1 sp → 1 cb,
1 cp → 1 lb — and idempotent, so a second run finds nothing to do. It covers
world actors, carried items, sidebar items and unlinked tokens. Compendium packs
are deliberately skipped and counted.

## Why this version mutates config in place

`CurrencyTemplate.defineSchema()` captures `CONFIG.DND5E.currencies` **by
reference** as its `initialKeys`. Assign a fresh object to
`CONFIG.DND5E.currencies` and the schema keeps pointing at the old one — the new
coins exist in the config table but in no actor's data.

The module gets away with replacing the table because schemas are built lazily,
after `init` completes. This script does not rely on that: it mutates the object
dnd5e already holds, which is correct whenever the schema happens to be built.
`validProperties` values are live `Set`s and are added to in place for the same
reason.

## Tests

Covered by `test/world-script.test.mjs` in the repo root, which stubs Foundry,
evaluates this file the way Foundry does, and fires `init`:

```
npm test
```
