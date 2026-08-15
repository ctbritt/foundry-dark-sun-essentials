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
import { buildDayPlan, clampExhaustion } from "./core/survival.mjs";

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
 * `species` is taken from the race item's identifier, which is what pack
 * beasts in the creature catalog carry. `assumedMedium` rides along so the
 * chat card can say out loud that it guessed.
 *
 * @param {Actor} actor
 * @returns {object}
 */
export function actorToMember(actor) {
  const size = actor.system?.traits?.size ?? null;
  const race = actor.system?.details?.race;
  const species = (typeof race === "string" ? race : race?.identifier ?? race?.name)
    ?.toLowerCase?.() ?? null;

  return {
    id: actor.id,
    name: actor.name,
    size: size ?? "med",
    assumedMedium: !size,
    species,
    isThriKreen: species === "thri-kreen" || species === "thrikreen",
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
 * @returns {object}
 */
export function planForActors(actors, conditions, intake = {}) {
  const members = actors.map(actor => {
    const member = actorToMember(actor);
    if ( actor.id in intake ) member.drunkGal = intake[actor.id];
    return member;
  });

  const plan = buildDayPlan({ members, conditions });

  // Carry the warnings the arithmetic layer has no way to know about.
  plan.warnings = members.filter(m => m.assumedMedium).map(m => m.name);
  return plan;
}
