# Survival Tracking — Design

**Date:** 2026-08-14
**Module id:** `dark-sun-essentials`
**Target:** Foundry VTT v13 + v14, dnd5e 5.3.x
**Builds on:** [2026-08-03-dark-sun-essentials-design.md](2026-08-03-dark-sun-essentials-design.md)
**Rules source:** `Dark Sun/1. CORE/ATHAS-5E/01-survival.md` (Athas 5e slice 1)

## Problem

Athasian travel is bookkeeping. Each day of a crossing, every creature in the
party has a water requirement that depends on its size or species, on whether
the party marched by day or by night, on the temperature, on whether it had
shade, and on whether it is wearing metal. Miss the arithmetic and the desert
stops being an opponent — which is the entire point of the setting.

Done by hand for a seven-member party over a seventeen-day crossing, that is
around a hundred and twenty multiplications, and the failure mode is not an
error the table notices. It is a crossing that was survivable when it should
not have been.

The rules already exist and are settled: `01-survival.md` is the shipped
ruleset, adjudicated against the 2024 PHB. What is missing is a way to run them
at the table without a spreadsheet.

## What ships

Two things, one automated and one not.

**Automated: water and exhaustion.** A macro the GM fires at the end of a
travel day. It reads the party, computes each creature's requirement, asks what
was actually drunk, and shows what happens — then writes only when the GM says
so.

**Text: everything else.** Food, foraging, forced march, navigation, cold
nights and weather ship as a journal entry in `packs/src/dark-sun-journals/`,
sourced from `01-survival.md`. They are rules the table reads, not rules the
module runs.

`00-decisions.md` does not ship. It names fan authors and cites their page
numbers, and this module is publicly distributed.

## A departure worth naming

Every existing feature in this module is descriptive. Coinage, materials,
psionics and vehicles mutate `CONFIG.DND5E` at `init` and then get out of the
way; two of their setting hints say "no automation" outright.

This feature acts on actors during play. It is the first one that does. That
justifies the confirmation gate in **Applying**, the failure behavior in
**When things are missing**, and a toggle that turns the whole thing off.

## Shape

| File | Foundry globals | Verified |
|---|---|---|
| `scripts/core/survival.mjs` | none | locally, `node --test` |
| `scripts/survival.mjs` | yes — reads actors, writes updates | Pi |
| `scripts/apps/survival-dialog.mjs` | yes — ApplicationV2 | Pi |

`core/survival.mjs` follows `core/coinage.mjs`: plain functions over plain
objects, importable from a test file with no game running. It takes
`{size, species, isThriKreen, conditions}` and returns numbers and verdicts. It
never touches an Actor.

Everything that knows what an Actor is lives in `scripts/survival.mjs`. That
split is what makes the conformance tests in **Testing** possible.

## The entry point is a macro

*Resolve Survival Day*, shipped in the existing `packs/dark-sun-macros`:

```js
game.modules.get("dark-sun-essentials").api.openSurvivalDialog();
```

Same shim pattern as *Convert to Athasian Coinage*: all logic stays in the
module, so a macro dragged into a world in 1.6 picks up 1.7's fixes.

This is a deliberate refusal to build UI. A scene control or a sheet button
means new render hooks, which are the most Foundry-version-fragile code in this
repo and the hardest to verify remotely. A macro is zero hooks and a drag to
the hotbar.

## The day, end to end

```
GM fires the macro
  │
  ├─ read the primary party Group actor
  │    no party set → notify, offer the current token selection
  │
  ├─ DIALOG, conditions for the day:
  │    pace       day march / night march / inactive
  │    heat       none / above 100 °F / above 130 °F
  │    shade      shade or shelter the whole day?
  │    then, per member: gallons drunk (defaults to the full requirement)
  │
  ├─ core/survival.mjs computes. Nothing is written.
  │
  ├─ CHAT CARD, per member: requirement, intake, consequence
  │             [ Apply ]   [ Cancel ]
  │
  └─ Apply → exhaustion updates, water item decrements
```

## Computing a requirement

Resolution order. First match wins.

1. **Thri-kreen** — 1 gallon per week. Heat multipliers do not apply at all.
2. **Named pack beast** — kank 2, inix 8, mekillot 16 gallons per day.
   Matched on `system.identifier`, falling back to name.
3. **Size** — Small ½, Medium 1, Large 4 gallons per day.

`01-survival.md` gives only those three sizes. dnd5e has six, so the module
extends the table with **Tiny ¼**, **Huge 16** and **Gargantuan 64**, each a
continuation of the ruleset's doubling. These three are the module's own
extrapolation, not shipped rules, and the test file marks them as such. In
practice the sizes that matter are covered: a mekillot is Huge and is priced by
its species rate, not by its size.

Then multiply every modifier that fits the day and round up to the quarter
gallon.

| Condition | Multiplier |
|---|---|
| Travelled 1+ hour above 100 °F | ×2 |
| Travelled 1+ hour above 130 °F | ×4 |
| Travelled by night instead of by day | ×½ |
| Under shade or shelter the whole day | ×½ |
| Inactive all day | ×½ |
| Wearing metal armour without shade | ×2 |

**Step 2 must beat step 3, and this is the bug to watch for.** A kank is Large.
The size table prices a Large creature at 4 gallons; the pack-beast table
prices a kank at 2. The species rate is correct and the size rate is a
fallback. Getting this backwards doubles every kank's thirst and cuts a
crossing's range roughly in half — it was a real defect in the vault's
`water_model.py` before slice 1 caught it.

### Metal armour

The `materialProperties` toggle already adds a Metal property to armour, so
when it is on, the module reads `system.properties` and the GM is not asked.

When it is off, the dialog asks per member. Both paths are tested; the module
must not assume its own optional feature is enabled.

### Thri-kreen and rounding

⅐ gallon rounded up to the quarter is 0.25, which is 1.75 gallons a week — a
75% tax on the one race whose signature trait is not needing water.

**Thri-kreen are exempt from the quarter-gallon rounding.** Their requirement
carries the exact ⅐ and displays as 0.14 gal. Over seven days it totals exactly
one gallon, which is what the rule says. Everyone else still rounds up.

This is not in `01-survival.md`. It is a new adjudication and needs its own
entry in the vault's `00-decisions.md`.

## Dehydration

Evaluated at the end of any day a creature drank less than it needed.

| Water drunk | Effect |
|---|---|
| Half or more of the requirement | DC 15 Constitution save, or 1 exhaustion level |
| Less than half | 1 exhaustion level, no save — 2 if it already had any exhaustion |
| None at all | 2 exhaustion levels |

Exhaustion clamps at 6. Under 2024 rules 6 is death, and the chat card says
**death** in plain words before the GM clicks Apply.

## Resting

A long rest removes 1 exhaustion level only if the creature both consumed at
least half its food and half its water that day, **and** had shade or shelter
for the rest. Without shelter a long rest removes nothing, and hit points come
back only by spending Hit Dice.

The module computes this verdict and reports it — `core/survival.mjs` exports a
pure function over `{ateHalf, drankHalf, hadShelter}`, and the chat card says
per member whether a long rest here would remove a level. It does not automate
the long rest itself. dnd5e owns resting, and intercepting its rest workflow
means hooks, which section **The entry point is a macro** exists to avoid.

Food intake is not tracked, so `ateHalf` is a checkbox on the dialog rather
than something the module reads. That is honest about the scope: the shelter
and water halves are computed, the food half is asserted by the GM.

## Applying

The card carries the computed plan in a message flag. Apply re-reads that plan
rather than recomputing, so the GM applies exactly what they were shown — a
setting changed between preview and Apply cannot silently alter the outcome.

Nothing is written before Apply. The reason is specific rather than general
caution: a defect that auto-applies two exhaustion levels to five characters is
a party kill the GM never authorised, and there is no undo inside Foundry.

## When things are missing

Each of these is a tested path.

| Situation | Behavior |
|---|---|
| No primary party Group | Notify, offer the current token selection. Never guess. |
| Actor has no size | Treat as Medium **and say so on the card** |
| No water items found | Compute the requirement, show supply as unknown, decrement nothing |
| Exhaustion would exceed 6 | Clamp at 6, label it death on the card |
| Non-GM fires the macro | Refuse, with a notification |
| Toggle off | Report that it is disabled and do nothing |

## Water supply

Read from inventory items, identified by `system.identifier` rather than by
name. The packs already carry `water-gallon`, `water-tun` and
`water-tun-250-gallons`; dnd5e's stock waterskin is 0.5 gallons.

Items may also declare `flags["dark-sun-essentials"].survival.waterGal`, which
takes precedence. That is the escape hatch for a world with its own containers.

Containers are bulk-limited, not weight-limited: a Medium creature carries 12
waterskins — 6 gallons — and no amount of Strength raises it. A Small creature
carries 6. Beasts carry casks (10 gallons, 85 lb) and are limited by weight
alone.

## Settings

One toggle, `survivalTracking`. World-scoped and GM-only like the rest, but
**`requiresReload: false`**.

That is a visible departure from `settings.mjs`, whose header comment explains
that every toggle requires a reload. The reason given there is that dnd5e
builds data model schemas from `CONFIG` on first document access, so a
mid-session change would exist in config but not in any actor's schema. This
toggle mutates no config — it gates a macro. The stated reason does not apply,
so the reload requirement does not either.

## Testing

Reported separately, per `CLAUDE.md`.

**Locally, `npm test`.** The whole of `core/survival.mjs`:

- Every constant asserted against the tables as written in `01-survival.md`,
  quoted as literals with decision IDs in comments. This is the drift detector:
  the module and the ruleset are checked against each other, by hand-copied
  literals, so a change to one fails the test rather than passing silently.
- The kank override beating the Large size rate
- Thri-kreen heat immunity, and thri-kreen exemption from rounding
- Quarter-gallon rounding for everyone else
- Modifier stacking — night plus shade is ×¼
- All four dehydration branches, including "2 if it already had any"
- All eight combinations of the long-rest recovery gate
- The container cap, Medium and Small
- Exhaustion clamping at 6

**On the Pi, and nowhere else.** The dialog rendering and collecting; the chat
card's Apply button under Foundry v14; `system.attributes.exhaustion` writes;
item quantity decrements; reading party Group members; metal-armour detection
through the material property.

Local tests are a pre-flight check. This is not done until it has loaded on the
Pi.

## Out of scope

Food consumption, the starvation clock, foraging rolls, forced-march saves,
cold-night saves, navigation, weather, and encounters. All ship as journal
text.

## Known data defects, recorded not fixed

- `Rations (15 days)` in `dark-sun-items` is recorded at **weight 0**. Food is
  out of scope this slice, but the entry will mislead any later carry-capacity
  work.
- The vault's `water_model.py` prices Small creatures at 1.0 gallon; the
  ruleset says ½. The ruleset is authoritative and the module encodes ½. The
  model needs the same correction — a vault-side fix, not a module one.

## Version

Ships as 1.6.0.
