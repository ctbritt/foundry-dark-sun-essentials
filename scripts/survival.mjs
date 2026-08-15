/**
 * Survival tracking — the half that knows what an Actor is.
 *
 * Everything here reads or writes Foundry documents, which is why none of it
 * lives in `core/survival.mjs` and why none of it is covered by `npm test`.
 * The arithmetic is over there and is tested; this file's job is to map
 * Actors onto the plain objects that module expects, and to apply what comes
 * back.
 */

import { MODULE_ID, SETTINGS } from "./core/constants.mjs";
import { log } from "./compat.mjs";
import { setting } from "./settings.mjs";
import { buildDayPlan, clampExhaustion, identifySpecies } from "./core/survival.mjs";

/**
 * The creatures this day applies to.
 *
 * Prefers the world's primary party, because it survives scene changes and a
 * GM already maintains it. Falls back to the current token selection, which is
 * explicit but forgettable. Returns null rather than guessing when there is
 * neither — a survival day resolved against the wrong creatures is worse than
 * one not resolved at all.
 *
 * @returns {Actor[]|null}
 */
export function resolveParty() {
  const party = game.actors?.party;
  const members = party?.system?.members ?? [];

  if ( members.length ) {
    // dnd5e models group membership as records wrapping an actor reference.
    // Tolerate both that and a bare actor, since the shape has moved between
    // system versions.
    return members.map(m => m.actor ?? m).filter(Boolean);
  }

  const selected = canvas?.tokens?.controlled?.map(t => t.actor).filter(Boolean) ?? [];
  if ( selected.length ) {
    log("debug", `No primary party set; falling back to ${selected.length} selected tokens.`);
    return selected;
  }

  return null;
}

/**
 * Does this actor wear metal armour?
 *
 * Reads the Metal material property this module adds when `materialProperties`
 * is on. When that toggle is off the property does not exist, so the answer is
 * always false here and the dialog asks the GM instead. The module must not
 * assume its own optional features are enabled.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasMetalArmor(actor) {
  if ( !setting(SETTINGS.materialProperties) ) return false;

  return actor.items?.some(item =>
    item.type === "equipment"
    && item.system?.equipped
    && item.system?.properties?.has?.("metal")
  ) ?? false;
}

/**
 * Flatten an actor's inventory into the shape `core/survival.mjs` reads.
 * @param {Actor} actor
 * @returns {Array<{identifier: string|null, type: string|null, quantity: number, flagGal: number|null}>}
 */
export function readItems(actor) {
  return (actor.items ?? []).map(item => ({
    identifier: item.system?.identifier ?? null,
    type: item.system?.type?.value ?? null,
    quantity: item.system?.quantity ?? 0,
    flagGal: item.getFlag?.(MODULE_ID, "survival.waterGal") ?? null
  }));
}

/**
 * Map one Actor onto a plain member object.
 *
 * Species identification is delegated to `core/survival.mjs`'s
 * `identifySpecies`, tried against the race item's identifier, the race
 * item's name, and finally the actor's own name, in that order — the race
 * item is trusted over the actor's name so a PC named "Kanko" cannot be
 * mistaken for livestock when they have a real race item. Every pack beast
 * this module ships has `race: null` and is identifiable only by name
 * ("Kank, Drone", "Mekillot Dirk"), which is why the actor's name is tried
 * at all; a naive read of `race.identifier` alone matches nothing for any
 * of them. `assumedMedium` rides along so the chat card can say out loud
 * that it guessed the size.
 *
 * @param {Actor} actor
 * @returns {object}
 */
export function actorToMember(actor) {
  const size = actor.system?.traits?.size ?? null;
  const race = actor.system?.details?.race;
  const raceIdentifier = typeof race === "string" ? race : race?.identifier ?? null;
  const raceName = typeof race === "string" ? null : race?.name ?? null;
  const { species, isThriKreen } = identifySpecies([raceIdentifier, raceName, actor.name]);

  return {
    id: actor.id,
    name: actor.name,
    size: size ?? "med",
    assumedMedium: !size,
    species,
    isThriKreen,
    metalArmor: hasMetalArmor(actor),
    currentExhaustion: actor.system?.attributes?.exhaustion ?? 0,
    drunkGal: null,
    items: readItems(actor)
  };
}

/**
 * Build a plan for the given actors under the given conditions.
 * @param {Actor[]} actors
 * @param {object} conditions
 * @param {Record<string, number|null>} [intake]  Actor id → gallons drunk.
 * @param {Record<string, boolean>} [armour]  Actor id → wearing metal armour,
 *   as answered by the GM when the module could not read it off the actor.
 * @returns {object}
 */
export function planForActors(actors, conditions, intake = {}, armour = {}) {
  const members = actors.map(actor => {
    const member = actorToMember(actor);
    if ( actor.id in intake ) member.drunkGal = intake[actor.id];
    // The GM's answer wins when the module had to ask. When material
    // properties are on it never asks, and `armour` arrives empty.
    if ( actor.id in armour ) member.metalArmor = armour[actor.id];
    return member;
  });

  const plan = buildDayPlan({ members, conditions });

  // Carry the warnings the arithmetic layer has no way to know about.
  plan.warnings = members.filter(m => m.assumedMedium).map(m => m.name);
  return plan;
}

/* -------------------------------------------- */
/*  Applying                                     */
/* -------------------------------------------- */

/**
 * Commit a plan the GM has approved.
 *
 * Reads the stored plan rather than recomputing, so what lands is what was on
 * the card. Rows whose outcome was a save are applied only if the caller has
 * already marked them failed — `row.saveFailed` — because this module does not
 * roll for a player.
 *
 * Failures are collected rather than thrown: one actor a GM lacks permission
 * to update should not abandon the other six mid-write.
 *
 * @param {object} plan
 * @returns {Promise<{applied: number, failed: string[]}>}
 */
export async function applyPlan(plan) {
  const failed = [];
  let applied = 0;

  for ( const row of plan.rows ) {
    const owed = row.outcome.kind === "save" ? (row.saveFailed ? row.outcome.levels : 0)
      : row.outcome.levels;
    if ( !owed ) continue;

    const actor = game.actors?.get(row.id);
    if ( !actor ) {
      failed.push(row.name);
      continue;
    }

    // Recompute the clamp against the actor's exhaustion as it stands now,
    // not as it stood when the card was posted. A GM who healed someone
    // between preview and Apply should not have that undone.
    const { final } = clampExhaustion(actor.system?.attributes?.exhaustion ?? 0, owed);

    try {
      await actor.update({ "system.attributes.exhaustion": final });
      applied += 1;
    } catch ( error ) {
      log("error", `Could not apply exhaustion to ${row.name}: ${error.message}`);
      failed.push(row.name);
    }
  }

  return { applied, failed };
}
