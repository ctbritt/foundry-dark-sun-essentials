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
import { planForActors, resolveParty } from "../survival.mjs";

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
    <input type="number" name="drunk.${actor.id}" min="0" step="0.25"
           placeholder="${t("drunk")}">
    ${askArmour ? `<label class="armour">
      <input type="checkbox" name="metal.${actor.id}">
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

  for ( const actor of actors ) {
    const raw = data[`drunk.${actor.id}`];
    const blank = (raw === "" || raw === null || raw === undefined);
    intake[actor.id] = blank ? null : Math.max(0, Number(raw) || 0);
    if ( askArmour ) armour[actor.id] = data[`metal.${actor.id}`] === true;
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
