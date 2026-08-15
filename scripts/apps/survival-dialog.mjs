/**
 * The survival day: ask what kind of day it was, then show what it cost.
 *
 * DialogV2, matching the migration dialog — available in both v13 and v14.
 * Nothing here computes anything; the arithmetic is in `core/survival.mjs` and
 * the actor reading is in `survival.mjs`. This file collects inputs and hands
 * the result to a chat card the GM still has to approve.
 */

import { MODULE_ID, SETTINGS } from "../core/constants.mjs";
import { setting } from "../settings.mjs";
import { log } from "../compat.mjs";
import { applyPlan, planForActors, resolveParty } from "../survival.mjs";

const { DialogV2 } = foundry.applications.api;

/** v13 namespaced it; the bare global is deprecated but still present. */
const FormDataExtended = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;

/** Escape untrusted text for interpolation into the dialog's HTML. */
const esc = value => foundry.utils.escapeHTML?.(String(value)) ?? String(value);

/**
 * Open the survival dialog and, if the GM confirms, post the plan.
 * @returns {Promise<void>}
 */
export async function openSurvivalDialog() {
  // Also the module's public API, so a player calling it from the console
  // must not get a dialog full of other people's exhaustion totals.
  if ( !game.user?.isGM ) {
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.notify.survivalGmOnly`));
    return;
  }

  if ( !setting(SETTINGS.survivalTracking) ) {
    ui.notifications?.warn(game.i18n.localize(`${MODULE_ID}.notify.survivalDisabled`));
    return;
  }

  const actors = resolveParty();
  if ( !actors?.length ) {
    ui.notifications?.warn(game.i18n.localize(`${MODULE_ID}.notify.noParty`));
    return;
  }

  // The armour question is only asked when the module cannot answer it. With
  // material properties on, it is read off the equipped armour instead.
  const askArmour = !setting(SETTINGS.materialProperties);

  const result = await DialogV2.wait({
    window: { title: `${MODULE_ID}.survival.dialogTitle`, icon: "fa-solid fa-sun" },
    position: { width: 460 },
    content: buildContent(actors, askArmour),
    buttons: [
      {
        action: "resolve",
        icon: "fa-solid fa-droplet",
        label: `${MODULE_ID}.survival.resolve`,
        default: true,
        callback: (event, button) => readForm(button.form, actors, askArmour)
      },
      {
        action: "cancel",
        icon: "fa-solid fa-xmark",
        label: `${MODULE_ID}.survival.cancel`
      }
    ],
    rejectClose: false,
    modal: true
  });

  // `cancel`, the close button, and Escape all land here.
  if ( !result || typeof result !== "object" ) {
    log("info", "Survival day declined.");
    return;
  }

  const plan = planForActors(actors, result.conditions, result.intake, result.armour);
  await postPlanCard(plan);
}

/* -------------------------------------------- */

/**
 * @param {Actor[]} actors
 * @param {boolean} askArmour
 * @returns {string}
 */
function buildContent(actors, askArmour) {
  const t = key => game.i18n.localize(`${MODULE_ID}.survival.${key}`);

  const radios = (name, options) => options.map(([value, key], index) => `<label>
    <input type="radio" name="${name}" value="${value}"${index === 0 ? " checked" : ""}>
    <span>${t(key)}</span>
  </label>`).join("");

  const rows = actors.map(actor => `<div class="dark-sun-survival-row">
    <span class="name">${esc(actor.name)}</span>
    <input type="number" name="drunk-${actor.id}" min="0" step="0.25"
           placeholder="${t("drunk")}">
    ${askArmour ? `<label class="armour">
      <input type="checkbox" name="metal-${actor.id}">
      <span>${t("metalArmor")}</span>
    </label>` : ""}
  </div>`).join("");

  return `
    <fieldset><legend>${t("pace")}</legend>
      ${radios("pace", [["day", "paceDay"], ["night", "paceNight"], ["inactive", "paceInactive"]])}
    </fieldset>
    <fieldset><legend>${t("heat")}</legend>
      ${radios("heat", [["none", "heatNone"], ["hot", "heatHot"], ["extreme", "heatExtreme"]])}
    </fieldset>
    <fieldset>
      <label><input type="checkbox" name="shaded"> <span>${t("shaded")}</span></label>
      <p class="notes">${t("shadedHint")}</p>
      <label><input type="checkbox" name="sheltered"> <span>${t("sheltered")}</span></label>
      <p class="notes">${t("shelteredHint")}</p>
      <label><input type="checkbox" name="ateHalf" checked> <span>${t("ateHalf")}</span></label>
    </fieldset>
    <div class="dark-sun-survival-members">${rows}</div>
  `;
}

/* -------------------------------------------- */

/**
 * Read the dialog back into the shapes `planForActors` expects.
 *
 * A blank intake stays null rather than becoming 0 — null means "drank their
 * fill", 0 means "drank nothing", and the two carry very different penalties.
 *
 * @param {HTMLFormElement} form
 * @param {Actor[]} actors
 * @param {boolean} askArmour
 * @returns {{conditions: object, intake: object, armour: object}}
 */
function readForm(form, actors, askArmour) {
  const data = new FormDataExtended(form).object;
  const intake = {};
  const armour = {};

  // Hyphenated, not dotted: a dotted field name risks FormDataExtended
  // expanding it into a nested object (`data.drunk[actorId]`) instead of the
  // flat key this reads. Keep it a hyphen — do not "tidy" this back to a dot.
  for ( const actor of actors ) {
    const raw = data[`drunk-${actor.id}`];
    const blank = (raw === "" || raw === null || raw === undefined);
    intake[actor.id] = blank ? null : Math.max(0, Number(raw) || 0);
    if ( askArmour ) armour[actor.id] = data[`metal-${actor.id}`] === true;
  }

  return {
    conditions: {
      pace: data.pace ?? "day",
      heat: data.heat ?? "none",
      shaded: data.shaded === true,
      sheltered: data.sheltered === true,
      ateHalf: data.ateHalf === true
    },
    intake,
    armour
  };
}

/* -------------------------------------------- */
/*  The card                                     */
/* -------------------------------------------- */

/** Two decimals, but only when they earn their place. A thri-kreen needs them. */
const gal = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/**
 * Post the plan for the GM to approve.
 *
 * The whole plan rides along in a message flag, and Apply reads it back rather
 * than recomputing — so what lands is what was on the card even if a setting
 * changed in between.
 *
 * @param {object} plan
 * @returns {Promise<ChatMessage>}
 */
export async function postPlanCard(plan) {
  const t = (key, data) => (data
    ? game.i18n.format(`${MODULE_ID}.survival.${key}`, data)
    : game.i18n.localize(`${MODULE_ID}.survival.${key}`));

  const rows = plan.rows.map(row => {
    // Death is shown instead of the save prompt, never behind it. Exhaustion
    // 6 is lethal under the 2024 rules and a GM should not have to read a DC
    // to notice they are about to kill someone.
    let result;
    if ( row.projected.lethal ) result = `<strong class="dse-lethal">${t("resultDeath")}</strong>`;
    else if ( row.outcome.kind === "save" ) result = t("resultSave", row.outcome);
    else if ( row.outcome.kind === "levels" ) result = t("resultLevels", row.outcome);
    else result = t("resultFine");

    // Only rows that owe a save get a checkbox. Everything else is decided.
    const tick = row.outcome.kind === "save"
      ? `<label><input type="checkbox" data-dse-save="${row.id}"> ${t("saveFailed")}</label>`
      : "";

    return `<tr>
      <td>${esc(row.name)}</td>
      <td>${gal(row.requiredGal)}</td>
      <td>${gal(row.drunkGal)}</td>
      <td>${result} ${tick}</td>
    </tr>`;
  }).join("");

  const notes = [];
  if ( plan.rows.some(r => r.outcome.kind === "save") ) notes.push(t("savesPending"));

  if ( !plan.totals.supplyGal ) notes.push(t("supplyUnknown"));
  else if ( plan.totals.daysOfSupply === null ) {
    notes.push(t("supplyNoDays", { gallons: gal(plan.totals.supplyGal) }));
  } else {
    notes.push(t("supply", {
      gallons: gal(plan.totals.supplyGal),
      days: plan.totals.daysOfSupply
    }));
  }

  // Rest is reported per member, but says the same thing for everyone unless
  // someone drank short. Report the exceptions rather than a wall of rows.
  if ( plan.rows.length && plan.rows.every(r => r.rest.removesExhaustion) ) notes.push(t("restYes"));
  else if ( plan.rows.length ) notes.push(t("restNo"));
  if ( plan.rows.some(r => !r.rest.fullHpRecovery) ) notes.push(t("restNoHp"));

  for ( const name of plan.warnings ?? [] ) notes.push(t("assumedMedium", { name: esc(name) }));
  for ( const row of plan.rows.filter(r => r.capExceeded) ) {
    notes.push(t("capExceeded", { name: esc(row.name) }));
  }

  const content = `<div class="dark-sun-survival-card">
    <h3>${t("cardTitle")}</h3>
    <table><thead><tr>
      <th>${t("colMember")}</th><th>${t("colNeeded")}</th>
      <th>${t("colDrunk")}</th><th>${t("colResult")}</th>
    </tr></thead><tbody>${rows}</tbody></table>
    ${notes.map(n => `<p class="notes">${n}</p>`).join("")}
    <button type="button" data-action="dse-apply-survival">${t("apply")}</button>
  </div>`;

  return ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    flags: { [MODULE_ID]: { survivalPlan: plan } }
  });
}

/* -------------------------------------------- */

/**
 * Apply a card's plan, taking the failed-save ticks from the card itself.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} button
 */
export async function onApplySurvival(message, button) {
  if ( !game.user?.isGM ) {
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.notify.survivalGmOnly`));
    return;
  }

  const plan = message.getFlag(MODULE_ID, "survivalPlan");
  if ( !plan ) return;

  const card = button.closest(".dark-sun-survival-card");
  for ( const row of plan.rows ) {
    const tick = card?.querySelector(`[data-dse-save="${row.id}"]`);
    row.saveFailed = tick?.checked === true;
  }

  // Disabled before the writes, not after: a double-click during a slow
  // update would otherwise apply the day twice.
  button.disabled = true;

  const { applied, failed } = await applyPlan(plan);
  ui.notifications?.info(game.i18n.format(`${MODULE_ID}.survival.applied`, { count: applied }));
  if ( failed.length ) {
    ui.notifications?.error(game.i18n.format(`${MODULE_ID}.notify.migrationPartial`, {
      count: failed.length
    }), { permanent: true });
  }
}
